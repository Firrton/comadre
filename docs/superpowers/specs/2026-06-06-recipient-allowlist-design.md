# Diseño — Allowlist incremental de destinatarios + confirmación por WhatsApp

- **Fecha:** 2026-06-06
- **Rama:** `feat/recipient-allowlist` (stacked sobre `chore/green-test-suite` → `feat/db-uuid-identity` / PR #26)
- **Hallazgo de auditoría:** COM-004 (CRITICAL) — OWASP LLM01. (Parte 3 = COM-033.)
- **Estado:** diseño revisado y aprobado sección por sección con el owner.

---

## 1. Contexto y problema

El LLM mueve dinero vía el tool `enviar_plata` → `POST /api/v1/transfers-monad` → `signMonadTransfer` (firma con session key Turnkey). Un prompt injection en contenido que el LLM ingiere puede disparar un envío al destinatario del atacante.

### Estado actual verificado (no el de la auditoría, que quedó viejo)

El fix "Phase 1B" existe pero **falla abierto**:
- `monadSessionSigner.ts:70-83`: el chequeo existe pero (L76) con allowlist vacía no valida, y (L74) con calldata indecodificable firma igual.
- `onboarding.ts:416`: instala con `allowedRecipients: []` → en la práctica **hoy nadie tiene enforcement de destinatario**.
- `onboarding.ts:407`: `permissionId: ""` (COM-033) → sin revocación on-chain.
- `systemPrompt.ts:89`: la "confirmación" actual es que el LLM pregunte → falsificable por la misma inyección.

### El punto de fondo: dos ejes de control, uno roto

| Eje | Control on-chain | Control backend | Estado |
|-----|------------------|-----------------|--------|
| **Monto** | `transfer` capeado `≤ cap` (`policies.ts:142`) | `perCallCapMicroUsdc` (`signer:66`) | ✓ Dos capas |
| **Destinatario** | abierto a propósito — `transferTargetPinTo` queda `null` (`policies.ts:138-141`) | el signer es el control designado… **pero falla abierto** (L74/L76) | ✗ Roto |

El comentario en `policies.ts:131-132` lo dice explícito: la arquitectura **delega** el enforcement del destinatario al backend. El problema no es el on-chain — es que el control que debía compensar no funciona, y la "confirmación" del LLM no es vinculante.

**Por qué el cap no alcanza:** acota el daño POR transacción, no el acumulado. El rate-limit on-chain es por **operaciones** (10 ops / 60s — `DAILY_RATE_OPS`), no por monto: hasta ~$500/min. Es un lomo de burro, no un muro.

**Consecuencia:** todo el cambio es sobre el eje "a-quién" — endurecer el único control designado (el signer) y agregar el camino legítimo de "contacto nuevo" (la confirmación), que el propio comentario on-chain ya anticipaba ("OOB flow"). El eje "monto" no se toca.

---

## 2. Decisiones tomadas

1. **Allowlist incremental + confirmación.** Destinatario nuevo → confirmación explícita; al confirmar se agrega a `allowedRecipients` y los próximos envíos a ese destinatario no preguntan.
2. **Confirmación validada por el backend, sin OTP.** Signer fail-closed. Agregar a la allowlist ocurre SOLO cuando el backend valida una respuesta afirmativa genuina contra un intent pendiente. El LLM nunca decide "confirmado".
3. **Estado pendiente en `transfers`** con nuevo status `awaiting_confirmation`.
4. **Enforcement off-chain en el signer** (no on-chain) — la arquitectura ya delega a propósito al backend.

---

## 3. Arquitectura — componentes que cambian

| Capa | Archivo | Cambio |
|------|---------|--------|
| Signer | `monadSessionSigner.ts` | Fail-closed: quitar fail-open de allowlist vacía (L76) y de calldata indecodificable (L74); reason nuevo `undecodable_calldata`. |
| Schema | `schema.ts` + migración | Nuevo valor `awaiting_confirmation` en `transferStatusEnum` (`ALTER TYPE ADD VALUE`). |
| Ruta transfer | `transfersMonad.ts` | Pre-check de allowlist en path inmediato; fuera de lista → `awaiting_confirmation` + `needsConfirmation`. Nuevo `POST /resolve-confirmation`. |
| Agente | `apps/agent/src/index.ts` | Helper `resolveTransferConfirmation()` (en `agent-tools/apiClient`, reusa HMAC); llamarlo antes del loop del LLM; `handled:true` → relevar y saltear LLM; **fail-open** ante error. |
| Tool | `agent-tools/src/tools.ts` + `types.ts` | **B2:** nuevo discriminante `confirmation` en `ToolResult`; el agente releva el `confirmationPrompt` **verbatim** y corta el turno. |
| System prompt | `systemPrompt.ts` | Apuntar a `enviar_plata` (NO a los tools legacy `confirmar_transfer`/`iniciar_transfer`). El LLM releva prompts del backend; no inventa confirmaciones. |
| Onboarding | `onboarding.ts` | Poblar `permissionId` + `policiesJson` al instalar (parte 3 / COM-033). |

**Decisiones de §3:** TTL = **15 min**. Vocabulario de contrato estandarizado (ver §4).

---

## 4. Flujos de datos

### 4.1 — Envío a destinatario NUEVO (registrado)
```
LLM → enviar_plata(to_phone, amount) → POST /transfers-monad
  backend: recipientWallet NO está en allowedRecipients
  → INSERT transfers (status=awaiting_confirmation, expiresAt=now+15min, datos completos)
  → 200 { ok:true, needsConfirmation:true, transferId, amountUsdc, confirmationPrompt, expiresAt }
  tool → ToolResult tipo `confirmation` (lleva confirmationPrompt)
  agente → releva confirmationPrompt VERBATIM y corta el turno (el LLM no lo toca)
```

### 4.2 — Resolución (segundo inbound)
```
[USER responde — inbound real desde SU número]
  whatsapp → agente /process
  → ANTES del loop del LLM: resolveTransferConfirmation(senderPhone, message)
       → POST /resolve-confirmation { senderPhone, message }
     backend (busca awaiting_confirmation abierto del sender, no expirado):
       - sin pendiente            → { handled:false }
       - afirmativo               → append recipientWallet a allowedRecipients (atómico, lowercase)
                                     → signMonadTransfer → update confirmed/failed
                                     → { handled:true, outcome:'confirmed', reply, txHash }
       - negativo                 → update cancelled → { handled:true, outcome:'cancelled', reply }
       - ambiguo (con pendiente)  → { handled:true, outcome:'reprompted', reply }   ← §8.a
  → handled:true  → el agente releva `reply` y NO llama al LLM
  → handled:false → sigue al loop del LLM como hoy
  (si /resolve-confirmation falla/timeout → fail-open: log y sigue al LLM; no se confirma nada, la fila expira)
```

### 4.3 — Envío repetido al MISMO destinatario
```
recipientWallet YA está en allowedRecipients → path inmediato firma directo, sin preguntar.
```

---

## 5. Modelo de datos

- `transferStatusEnum`: agregar `'awaiting_confirmation'` (después de `'awaiting_recipient'`).
- **Sin columnas nuevas.** La fila `transfers` ya tiene `senderId`, `recipientId`, `recipientWallet` (el address que se agrega a la allowlist), `recipientPhoneHash`, `amountMicroUsdc`, `note`, `expiresAt`, `confirmedAt`, `txSignature`, `failureReason`.
- **`expiresAt = now + 15 min` es una ventana de SEGURIDAD**, no de limpieza: evita que un "sí" descolgado mucho después confirme un pendiente plantado por inyección.
- **Invariante "uno abierto por sender":** al crear un `awaiting_confirmation`, cancelar cualquier otro abierto del mismo sender (supersede) → el "sí" queda inequívoco.
- **Expiración lazy (sin cron):** la lookup filtra `expiresAt > now`; opcionalmente marca `expired` de paso.
- **Query de resolución:** `transfers` WHERE `senderId = <sender>` AND `status = 'awaiting_confirmation'` AND `expiresAt > now()` ORDER BY `createdAt DESC` LIMIT 1. Conviene índice `(senderId, status)`.

---

## 6. Enforcement del signer (fail-closed)

`monadSessionSigner.ts`, nueva semántica:
1. Decodificar calldata. Si NO decodifica como `transfer(to, amount)` → rechazar `undecodable_calldata`.
2. Si decodifica → el destinatario DEBE estar en `allowedRecipients` (lowercase). Vacío o ausente → `recipient_not_allowed`.

Se quitan los dos fail-open (L74, L76).

**Defensa en profundidad:** en los caminos felices el signer siempre recibe un destinatario ya permitido (la ruta deriva los no-permitidos a confirmación; `/resolve-confirmation` agrega antes de firmar). El signer fail-closed es el **backstop** para cualquier otro path.

**Gotcha de orden:** en `/resolve-confirmation`, el append a `allowedRecipients` debe estar **commiteado antes** de llamar al signer (que re-lee la session key desde la DB).

---

## 7. `permissionId` + `policiesJson` al instalar (parte 3 / COM-033)

Independiente del fix de allowlist; habilita el kill-switch on-chain. **Option B (rebuild server-side):**
1. Al instalar (`onboarding.ts`), reconstruir el validator con el **address de la session key** (signer vacío vía `addressToEmptyAccount`) + los mismos inputs de `buildPolicies()`.
2. `toPermissionValidator(...).getIdentifier()` → `permissionId`.
3. `policiesJson` guarda los **inputs** de las policies (`kind`, addresses, caps, flag Neverland) — NO los objetos `Policy` (callbacks no serializables).

**DRY:** extraer un helper compartido en `wallet-infra` (`computePermissionId(input)`) usado por install y `revoke.ts`. Rebuild server-side evita mismatches por diferencia de versión cliente/server.

---

## 8. Casos borde

- **Calldata indecodificable** → fail-closed (§6).
- **Múltiples pendientes** → uno por sender, supersede (§5).
- **TTL vencido** → lazy filter (§5).
- **Self-transfer** → ya bloqueado en `transfersMonad.ts`.
- **8.a — Confirmación ambigua con pendiente** → el backend devuelve un **re-prompt** (`outcome:'reprompted'`, `handled:true`), salteando el LLM; el escape es "NO"; el TTL de 15 min lo libera. (No infinito: tras el TTL, se libera solo.)
- **8.b — Path deferred** (destinatario no registrado) → **fuera de alcance, documentado**: no firma, no aplica el gate todavía; el release futuro pasará por el mismo signer fail-closed y, si no está en allowlist, caerá en `awaiting_confirmation`. No es el vector de drenaje.

---

## 9. Por qué es injection-proof

- "Agregar a allowlist" vive SOLO en `/resolve-confirmation`.
- **No existe tool** para agregar a la allowlist.
- El **parseo del afirmativo lo hace el backend**, no el LLM.
- La inyección **no puede mandar mensajes como el usuario** (inbound desde su número real, verificado por Twilio).
- Signer **fail-closed** = backstop.
- `confirmationPrompt` **verbatim** (WYSIWYG) + ventana de **15 min**.

### 9.x — Riesgos residuales (honestos)

1. **Signer/blob comprometido (el grande).** El enforcement es off-chain, en nuestro código. Si se compromete la clave Turnkey del agente o el blob serializado, un atacante podría firmar **directo, sin pasar por nuestro path** → la allowlist no lo frena (on-chain no pinea el destinatario). Esto es lo que cerraría el **pinning on-chain (diferido, §10)**.
2. **Ingeniería social del usuario.** La inyección puede *disparar* un envío (se crea el pendiente y el usuario ve el `confirmationPrompt` verbatim con el número/monto reales del atacante). Para completar, el usuario tendría que decir "sí" a un número desconocido. Mitiga el verbatim; el resto es educación, no código.
3. **Ruido de pendientes.** La inyección puede generar prompts molestos; mitigado por "uno por sender + supersede".

---

## 10. Fuera de alcance (unidades diferidas, documentadas)

- **Cap de monto acumulado diario con reseteo** (eje monto, defensa en profundidad).
- **Pinning on-chain del destinatario** (`ParamCondition.EQUAL`) — cerraría el residual #1; impráctico con allowlist incremental (re-install por contacto). Documentado como decisión.
- **Harness de test DB** (Postgres local / testcontainers) para los tests de orquestación end-to-end (§11).
- Phone hashing → HMAC + pepper; rate-limit + idempotencia adicional en `/transfers-monad`; mover `sessionPkMemory`/`seenSignatures` a Redis.

---

## 11. Testing

**Restricción real:** los tests de `apps/api` corren **sin infra viva** (no hay test DB).

**Funciones puras (lo crítico, infra-free) — no negociable:**
- `evaluateRecipient(allowedRecipients, calldata)` → `{ok}` | `{ok:false, reason}`. Tests: lista vacía → rechaza; presente → ok; ausente → rechaza; `undecodable_calldata`; case-insensitivity.
- `parseConfirmation(message)` → `affirmative | negative | ambiguous`. Tests: set conservador, trim/lowercase, falsos positivos (`sígueme` ≠ `sí`), emojis.
- `buildConfirmationPrompt(recipient, amount)` → texto verbatim que nombra destinatario + monto.

Encaja con el codebase (ya hay tests de funciones puras en `apps/api/src/lib/__tests__`).

**Orquestación con DB → Opción A:** cobertura de funciones puras ahora + verificación manual/integración; el **harness de test DB queda como unidad aparte (§10)**.

---

## 12. Unidades de entrega — cadena de PRs

**Orden por dependencia (NO por número de "parte").** Shipear el signer fail-closed antes del flujo de confirmación rompería TODOS los envíos (allowlists vacías + sin forma de poblarlas).

- **PR A — Fundación (inerte):** enum + migración + funciones puras + tests. Seguro de mergear solo.
- **PR B — Flujo de confirmación (backend + agente JUNTOS):** pre-check en `transfersMonad` + `/resolve-confirmation` + intercepción en el agente (`resolveTransferConfirmation`, fail-open) + tool B2 + system prompt. **Cierra el vector** a nivel ruta. Backend y agente van juntos por el acople. El más grande → puede pedir `size:exception`.
- **PR C — Signer fail-closed (backstop):** cablear `evaluateRecipient` en `signMonadTransfer`. **Mergea DESPUÉS de B.** Chico.
- **PR D — `permissionId` + `policiesJson` (COM-033):** independiente, cualquier momento.

**Orden de merge seguro:** A → B → C. D suelto. (C nunca antes de B; B+agente juntos.)

---

## 13. Detalles finos

**`parseConfirmation` — principio:** conservador, sesgado al **falso negativo** (un falso positivo confirma plata; un falso negativo solo re-pregunta). **Match de palabra entera, NUNCA substring**; normaliza trim+lowercase+sin puntuación/emoji.
- Afirmativo: `sí`, `si`, `dale`, `ok`, `confirmo`, `yes`, `✅`
- Negativo: `no`, `cancelar`, `cancela`, `cancelá`, `❌`
- Resto → ambiguo. (El set se amplía iterativamente más adelante.)

**Textos canónicos (backend, verbatim). `{recipientPhone}` se muestra COMPLETO** (destinatario nuevo: el usuario debe verificar a quién manda; en logs sigue redactado):
- Inicial: *"Es la primera vez que enviás a {recipientPhone}. ¿Confirmás enviar {amount} USDC? Respondé SÍ para confirmar o NO para cancelar."*
- Re-prompt (8.a): *"Tenés un envío pendiente de {amount} USDC a {recipientPhone}. Respondé SÍ o NO."*
- Confirmado: *"Listo, envié {amount} USDC a {recipientPhone}."*
- Cancelado: *"Cancelado, no envié nada."*
