# Diseño — Allowlist incremental de destinatarios + confirmación por WhatsApp

- **Fecha:** 2026-06-06
- **Rama:** `feat/recipient-allowlist` (stacked sobre `chore/green-test-suite` → `feat/db-uuid-identity` / PR #26)
- **Hallazgo de auditoría:** COM-004 (CRITICAL) — OWASP LLM01
- **Estado:** propuesta de diseño, pendiente de aprobación del owner

---

## 1. Contexto y problema

El LLM mueve dinero vía el tool `enviar_plata` → `POST /api/v1/transfers-monad` → `signMonadTransfer` (firma con session key Turnkey). Un prompt injection en contenido que el LLM ingiere puede disparar un envío al destinatario del atacante. El cap por transacción (`perCallCapMicroUsdc`) limita el **monto**, no el **a-quién** — la cuenta se puede drenar en múltiples envíos.

### Estado actual verificado (NO el de la auditoría, que quedó viejo)

El doc `docs/audits/03-security.md` describe el estado pre-fix. El código actual ya tiene un fix parcial ("Phase 1B"), pero **falla abierto**:

- **`apps/api/src/lib/monadSessionSigner.ts:70-83`** — el enforcement de destinatario EXISTE pero:
  - **Línea 76:** `if (allowedRecipients.length > 0)` → con allowlist vacía no valida nada.
  - **Línea 74:** `if (decoded)` → si el calldata no decodifica como `transfer(to,amount)`, firma sin chequear.
- **`apps/api/src/routes/onboarding.ts:416`** instala con `allowedRecipients: []` → en la práctica, **hoy nadie tiene enforcement de destinatario**.
- **`onboarding.ts:407`** instala con `permissionId: ""` (COM-033) → sin revocación on-chain (`uninstallValidator`).
- **La "confirmación" actual** es que `systemPrompt.ts:89` le pide al LLM que pregunte antes de enviar. **Eso es lo que LLM01 rompe**: una confirmación interpretada por el LLM es falsificable por la misma inyección.

---

## 2. Decisiones tomadas (por el owner)

1. **Allowlist incremental + confirmación.** Un destinatario nuevo exige confirmación explícita; al confirmar, se agrega a `allowedRecipients` y los próximos envíos a ese destinatario NO piden confirmación. Cierra el vector sin depender de una agenda de contactos.
2. **Confirmación validada por el backend, sin OTP.** El signer pasa a fail-closed. Agregar a la allowlist ocurre SOLO cuando el backend valida una respuesta afirmativa genuina del usuario contra un intent pendiente. El LLM nunca decide "confirmado".
3. **Estado pendiente en `transfers`** con un nuevo status `awaiting_confirmation`. La fila misma carga los datos para reanudar.
4. **Enforcement off-chain en el signer** (no on-chain). Ver §10.

---

## 3. Arquitectura — componentes que cambian

| Capa | Archivo | Cambio |
|------|---------|--------|
| Signer | `apps/api/src/lib/monadSessionSigner.ts` | **Fail-closed**: quitar el fail-open de allowlist vacía (L76) y el de calldata indecodificable (L74). Sin destinatario probadamente permitido → no firma. |
| Schema | `packages/db/src/schema.ts` + migración | Nuevo valor `awaiting_confirmation` en `transferStatusEnum`. |
| Ruta transfer | `apps/api/src/routes/transfersMonad.ts` | Path inmediato: si el destinatario NO está en allowlist → crear `awaiting_confirmation` (sin firmar) y devolver `needsConfirmation`. Nuevo endpoint interno `POST /resolve-confirmation`. |
| Agente | `apps/agent/src/index.ts` | En cada inbound, ANTES del loop del LLM, llamar a `/resolve-confirmation`. Si el backend lo resuelve, relevar el resultado y NO invocar al LLM. |
| Tool | `packages/agent-tools/src/tools.ts` | `enviar_plata` maneja `needsConfirmation` y devuelve al LLM el prompt canónico para relevar. |
| System prompt | `apps/agent/src/lib/systemPrompt.ts` | Aclarar que la confirmación de destinatario nuevo la maneja el sistema (no inventar confirmaciones). |
| Onboarding | `apps/api/src/routes/onboarding.ts` | Poblar `permissionId` + `policiesJson` al instalar (parte 3). |

---

## 4. Flujo de datos

### 4.1 Envío a destinatario NUEVO (registrado, path inmediato)

```
LLM → enviar_plata(to_phone, amount) → POST /api/v1/transfers-monad
  backend: recipient registrado; recipientWallet NO está en allowedRecipients
  → INSERT transfers (status=awaiting_confirmation, TTL 5 min, datos completos)
  → 200 { ok:true, needsConfirmation:true, confirmationPrompt }
  tool → devuelve al LLM el confirmationPrompt
  agente → relata: "Es la primera vez que enviás a +52XXX. ¿Confirmás 50 USDC? Respondé SÍ."
```

### 4.2 Resolución de la confirmación (segundo inbound)

```
[USER responde "SÍ" — inbound real desde SU número]
  whatsapp → agente /process
  → ANTES del loop del LLM: POST /api/v1/transfers-monad/resolve-confirmation { senderPhone, message }
     backend:
       - busca awaiting_confirmation abierto del sender (no expirado)
       - parsea el mensaje (set explícito de afirmativos/negativos — backend, no LLM)
       - AFIRMATIVO → add recipientWallet a allowedRecipients → signMonadTransfer
                      → update transfer confirmed/failed → { handled:true, outcome }
       - NEGATIVO   → update transfer cancelled → { handled:true, outcome:"cancelled" }
       - NINGUNO/AMBIGUO → { handled:false }
  → handled:true  → el agente relata el outcome y NO llama al LLM
  → handled:false → el agente sigue al loop del LLM como hoy
```

### 4.3 Envío repetido al MISMO destinatario

```
recipientWallet YA está en allowedRecipients → path inmediato firma directo, sin preguntar.
```

---

## 5. Modelo de datos

- `transferStatusEnum`: agregar `'awaiting_confirmation'` (junto a `pending | awaiting_recipient | confirmed | expired | cancelled | failed`).
- Reusar la fila `transfers` existente como estado pendiente: ya tiene `senderId`, `recipientId`, `recipientWallet`, `recipientPhoneHash`, `amountMicroUsdc`, `note`, `expiresAt`.
- `expiresAt` para `awaiting_confirmation`: **5 minutos**. Expiración lazy (se chequea al leer; los cron jobs se sacaron en el refactor UUID).
- Regla: **una sola confirmación abierta por sender**. Un nuevo `enviar_plata` a otro destinatario nuevo cancela (supersede) la anterior.

---

## 6. Enforcement del signer (parte 1, fail-closed)

`monadSessionSigner.ts` — nueva semántica:

1. Decodificar el calldata. Si NO decodifica como `transfer(to, amount)` → **rechazar** (`recipient_not_allowed` o nuevo reason `undecodable_calldata`). No se puede probar el destinatario → no se firma.
2. Si decodifica: el destinatario DEBE estar en `allowedRecipients` (comparación lowercase). Vacío o no-presente → **rechazar** (`recipient_not_allowed`).

> Esto invierte el fail-open actual. Con allowlist incremental, el primer envío a cualquiera siempre cae en "no permitido" → dispara confirmación. Es el comportamiento esperado.

`transfersMonad.ts` — el reason `recipient_not_allowed` en el path inmediato ya no es un 403 duro: se traduce en crear `awaiting_confirmation` + `needsConfirmation` (el endpoint decide esto ANTES de llamar al signer chequeando membership; el signer queda como defensa en profundidad).

---

## 7. permissionId al instalar (parte 3)

- Poblar `session_keys.permissionId` y `session_keys.policiesJson` en `onboarding.ts` al crear la session key.
- `revoke.ts` hoy reconstruye el plugin desde las policies (no usa un `permissionId` guardado), así que la revocación blanda funciona; poblar `permissionId` habilita el path directo `uninstallValidator(permissionId)` y deja trazabilidad.
- **A confirmar en implementación:** la API exacta del SDK ZeroDev para obtener el `permissionId` determinístico desde `toPermissionValidator` (extender `ApproveSessionKeyResult` vs computarlo server-side desde `buildPolicies()`). No bloquea el diseño.

---

## 8. Casos borde

- **Calldata indecodificable** → fail-closed (rechaza).
- **Confirmación ambigua** (ni sí ni no claro) → `{ handled:false }`; el intent queda abierto hasta el TTL; el mensaje pasa al LLM como normal.
- **Múltiples pendientes** → uno por sender; el nuevo supersede al anterior (cancela).
- **TTL vencido** → al leer, si expiró se marca `expired` y se trata como inexistente.
- **Path deferred** (destinatario no registrado) → no firma, no aplica el gate todavía. El release (cuando el destinatario se registra) pasa por el mismo signer fail-closed; el manejo de allowlist en el release queda documentado como sub-caso aparte (no es el vector de drenaje; el path de release automático puede no existir aún).
- **Self-transfer** → ya bloqueado en `transfersMonad.ts`.

---

## 9. Seguridad — por qué es injection-proof

- El "agregar a allowedRecipients" vive SOLO dentro de `/resolve-confirmation`, disparado SOLO por una respuesta afirmativa genuina, desde el número del usuario, contra un intent abierto.
- **No existe ningún tool** que el LLM pueda llamar para agregar a la allowlist.
- El **parseo del afirmativo** lo hace el backend, no el LLM → la inyección no puede fabricar el "el usuario ya dijo que sí".
- La inyección no puede **enviar mensajes como el usuario** (el inbound viene del número real del usuario, verificado por el webhook de Twilio).
- El signer es fail-closed → aunque algo falle arriba, sin destinatario en la allowlist no se firma.

---

## 10. Fuera de alcance (decisión explícita)

- **Pinning on-chain del destinatario** (`ParamCondition.EQUAL` en `USDC.transfer`). La allowlist es incremental → pinnearla on-chain obligaría a re-instalar la session key (cambia el `permissionId`) en cada contacto nuevo: impráctico. Para el vector real (inyección por el agente, que SIEMPRE pasa por `signMonadTransfer`), el enforcement off-chain es la capa correcta. Se documenta como decisión, no como omisión.
- Unidades separadas, después: phone hashing → HMAC+pepper; rate-limit + idempotencia adicional en `/transfers-monad`; mover `sessionPkMemory`/`seenSignatures` a Redis.

---

## 11. Testing

Tests nuevos (en `apps/api`, que corre sin infra viva con `DEV_AUTH_BYPASS`):

- `monadSessionSigner`: rechaza destinatario fuera de allowlist (incluida lista **vacía**) ANTES de firmar.
- `monadSessionSigner`: firma destinatario presente en allowlist.
- `monadSessionSigner`: rechaza calldata indecodificable.
- Flujo `transfersMonad`: destinatario nuevo → `awaiting_confirmation` + `needsConfirmation`, sin firmar.
- `resolve-confirmation`: afirmativo → agrega a allowlist + firma; negativo → cancela; ninguno → `handled:false`.
- Regresión: segundo envío al mismo destinatario → firma directo.

---

## 12. Unidades de entrega (PRs encadenados)

1. **Signer fail-closed + tests** (chico, parte 1). Alto valor, autocontenido.
2. **Flujo de confirmación** (mediano, parte 2): status `awaiting_confirmation` + migración, cambios en `transfersMonad`, endpoint `/resolve-confirmation`, intercepción en el agente, manejo en `enviar_plata`, system prompt. Puede acercarse al presupuesto de 400 líneas → posible PR encadenado.
3. **`permissionId` + `policiesJson` al instalar** (chico, parte 3). Independiente.

---

## 13. A confirmar en implementación

- API exacta de ZeroDev para `permissionId` (§7).
- Set exacto de afirmativos/negativos para `/resolve-confirmation` (§4.2) — set explícito y conservador.
- Texto canónico del `confirmationPrompt` (debe nombrar destinatario + monto).
