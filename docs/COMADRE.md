# Comadre — Documento canónico (visión + arquitectura)

> **Fuente de verdad del proyecto.** Si algo en otro doc o en el código contradice esto, esto manda (o esto está desactualizado y hay que arreglarlo). Última revisión: 2026-06-05.
>
> Secciones marcadas con 🖊️ **DEFINIR JUNTOS** están pendientes de tu decisión — no las inventé.

---

## 1. Qué es Comadre

Comadre es un **agente de IA dentro de WhatsApp** que ayuda a personas **no expertas en cripto** a manejar su dinero on-chain sin saber nada de cripto. Hablás con Comadre por WhatsApp como con una persona, y por detrás opera una **wallet custodial** sobre la blockchain de **Monad**.

**Para quién:** gente común de LATAM, sin conocimiento técnico de cripto. La complejidad (claves, gas, contratos, redes) queda **escondida**: el usuario solo ve plata y conversación.

> 🖊️ **DEFINIR JUNTOS** — la promesa de marca en una frase (el "elevator pitch"). Ej: _"Tu comadre de confianza para guardar, enviar y hacer crecer tu plata, por WhatsApp."_ Ajustá a tu voz.

---

## 2. Alcance del MVP

Estamos en **Monad testnet**. El MVP busca el flujo completo de una wallet conversacional básica, **sin smart contracts propios**.

### Entra al MVP
- **Onboarding** por WhatsApp + creación de wallet custodial (magic-link → Privy owner + session key acotada).
- **Enviar plata (P2P)** — transferencia de USDC en Monad vía session key (`enviar_plata` → `/api/v1/transfers-monad`). Es `USDC.transfer` estándar, sin contrato propio.
- **Recibir plata + aviso de depósito** — detectar USDC entrante y avisar por WhatsApp. ⚠️ Requiere **construir un indexer de Monad** (el actual es Solana y se borra).
- **Guardadito (ahorro con yield)** — vía **Neverland** (fork de Aave V3 ya desplegado en Monad), sin contrato propio. Yield "de testnet" (funcional, no económico real).

### Queda para DESPUÉS (no-MVP)
- **Tandas / ROSCA** — requieren contrato propio (`monad-contracts/Comadre.sol`, hoy **aparcado**).
- **Crédito social / comunitario** — residuo de la visión vieja; se quita del MVP.
- **Vaults avanzados, staking** — fase posterior.
- **Mainnet + yield económico real** — cuando se decida el salto a producción.
- **KYC (Sumsub)** — código presente pero **dormido**; no entra al MVP.

---

## 3. Decisiones tomadas (locked)

| Tema | Decisión | Nota |
|---|---|---|
| **Cadena** | Monad **testnet** (chain `10143`) | Excisión total de Solana (ya hecha en `main`). |
| **Canal** | **OpenWA** (migrado de Twilio — 2026-06-11) | ⚠️ OpenWA automatiza WhatsApp Web de forma no oficial → riesgo de ban. OK para MVP/testnet. Sandbox en `experimental/openwa/`. Ver runbook QR más abajo. |
| **Custodia** | **Turnkey HSM** + **ZeroDev Kernel v3.1** + **Pimlico** (bundler ERC-4337) | Owner del smart account vía **Privy**. KMS propio eliminado. |
| **LLM** | **Kimi K2.x** vía Moonshot | Soporta razonamiento con temperatura condicional. |
| **Allowlist de destinatarios** | **Confirmación + allowlist incremental** | Destinatario nuevo requiere confirmación explícita por WhatsApp antes del 1er envío; cierra el vector de drenaje del LLM (OWASP LLM01). |
| **Gestor de paquetes** | Migrar **bun → pnpm** | Pendiente de ejecutar. bun puede seguir como runtime. |
| **`monad-contracts`** | **Aparcado** | Es el port a Solidity de las tandas; vuelve con la fase de tandas. |

---

## 4. Arquitectura

### Topología (apps que viven en el MVP)

```
WhatsApp (OpenWA)  →  apps/api (Monad-only)  ⇄  apps/agent (Kimi K2.x)
                          │
   apps/web (/o/[token])  ── onboarding (Privy SMS + instalación de session key)
                          │
   apps/indexer (RECONSTRUIR para Monad)  ── detección de depósitos entrantes
```

| App / Paquete | Rol | Estado |
|---|---|---|
| `apps/whatsapp` | Bridge del canal (**OpenWA** — migración de Twilio completada 2026-06-11) | vivo |
| `apps/api` | Backend central Hono/Bun (Monad-only) | vivo |
| `apps/agent` | Loop de tool-use con Kimi K2.x | vivo |
| `apps/web` | Landing + `/privacy` + onboarding browser (`/o/[token]`) | vivo — en el workspace desde 2026-06-11 |
| `apps/indexer` | Indexer de eventos | **reconstruir para Monad** (el actual es Solana) |
| `apps/cron` | Jobs programados | solo `scheduler.ts`; jobs viejos a reescribir/borrar |
| `packages/wallet-infra` | Frontera de custodia (Turnkey/ZeroDev/Pimlico/session keys) | núcleo de seguridad |
| `packages/agent-tools` | Registro de tools del agente (21, **podar a ~14**) | vivo |
| `packages/db` | Drizzle schema (21 tablas, **podar 7 de tanda**) | vivo |
| `packages/cache` | Upstash Redis (idempotencia, rate-limit, ventana WA) | sano |
| `packages/config` / `packages/types` | Env loader + tipos de frontera (**dividir** actual vs legacy) | vivo |
| `packages/monad-contracts` | Contratos Solidity (port de tandas) | **aparcado** |
| ~~`packages/anchor-program` / `anchor-client` / `solana`~~ | Stack Solana | **eliminado** |

### Flujo de custodia (una sola dirección, sin atajos)

```
agente  →  api  →  monadSessionSigner  →  wallet-infra (Turnkey firma; la clave
                                          nunca entra al proceso)  →  Pimlico  →  Monad
```

El **agente nunca toca la cadena directamente**. Toda firma pasa por `wallet-infra`, donde Turnkey custodia el material criptográfico en HSM.

---

## 5. Modelo de datos

DB Postgres vía Drizzle. **Identidad del cliente = `users.id` (UUID surrogate).** El cliente se identifica por `phone_hash` (UNIQUE); su wallet es `smart_wallets.smart_wallet_address`; `users.owner_address` (UNIQUE) es la llave de lookup del auth (dirección owner de Privy). Todas las FKs referencian `users.id` (`user_id`).

Tablas vivas (14): `users`, `smart_wallets`, `session_keys`, `auth_sessions`, `elevated_intents`, `transfers`, `conversations`, `idempotency_keys`, `ramps`, `kyc_sessions`, `savings_positions`, `savings_actions`, `savings_nudges`, `contact_routes`. Las 7 tablas de tanda + 5 enums + columnas de reputación fueron **excisadas**; migraciones con baseline-reset a un único `0000_init`. Detalle: `docs/superpowers/plans/2026-06-05-db-uuid-identity.md`.

---

## 6. Seguridad

- **Custodia:** Turnkey HSM — las claves nunca están en texto plano ni en memoria del proceso.
- **Session keys:** acotadas por monto por transacción + (a implementar) **allowlist incremental** de destinatarios + `permissionId` para revocación on-chain.
- **Hallazgos abiertos** (de la auditoría — ver `docs/audits/`):
  - Allowlist de destinatarios no se aplica todavía (vector de drenaje vía LLM).
  - `permissionId` vacío → sin kill-switch on-chain.
  - Hash de teléfono sin sal (SHA-256) → migrar a HMAC + pepper.
  - `Pool.withdraw` de Neverland sin restringir (al activar yield).
  - Secretos rotados: **pendiente** (los `.env.test` estuvieron en git; rotar en cada dashboard).

Detalle del modelo de amenazas y custodia: `docs/WALLET_SECURITY.md` (actualizar secciones KMS→Turnkey).

---

## 7. Estado actual (2026-06-05)

- ✅ Repo **consolidado en `main`** (antes: 64 ramas / 24 worktrees → 4 ramas / 1 worktree).
- ✅ Migración a **Turnkey completa** en `main`; KMS muerto eliminado; el repo compila conceptualmente.
- ✅ Secretos **fuera del tracking** de git (rotación pendiente del owner).
- ✅ Docs **limpiados** (este doc reemplaza a 9 docs obsoletos).
- ⏳ `main` tiene 4 commits locales **sin pushear**.

### Camino al MVP (orden sugerido)
1. Verificar build (typecheck verde).
2. Migrar a pnpm.
3. Excisión de DB (borrar tablas/tools de tanda; podar agent-tools; dividir config/types).
4. Seguridad del path de dinero (allowlist incremental, `permissionId`, phone HMAC).
5. Features MVP: migrar canal a OpenWA, indexer Monad (recibir), Guardadito vía Neverland.
6. Pase de verdad en docs (regenerar modelo de datos, READMEs, WALLET_SECURITY).

---

## 8. Decisiones abiertas (definir juntos)

- 🖊️ Frase de marca / promesa (sección 1).
- 🖊️ Fuente de los contactos para la allowlist (¿agenda del usuario? ¿confirmación 1-a-1 nomás?).
- 🖊️ Timing de KYC (¿antes de mover plata? ¿por monto?).
- 🖊️ Timing del salto a **mainnet** (define cuándo se enciende yield real y contratos propios).
- 🖊️ Cuándo vuelven las **tandas** al roadmap (reactiva `monad-contracts`).
- 🖊️ Proveedor de OTP para `elevatedIntents` (Twilio Verify removido; actualmente fail-closed 503 hasta que se decida alternativa — Privy passkey, código in-house, u otro).

---

## 9. Runbook operativo — OpenWA

### Configuración inicial OpenWA (QR)

Esta configuración se hace una sola vez por número de WhatsApp. La sesión persiste en el volumen Docker `openwa-sessions` y no requiere re-escaneo al reiniciar el contenedor (a menos que WhatsApp invalide la sesión).

**Pasos:**

1. **Preparar el sandbox OpenWA:**
   ```bash
   cd experimental/openwa
   cp .env.example .env
   # Editar .env: generar un API_MASTER_KEY fuerte (ej: openssl rand -hex 32)
   docker compose up -d
   # Esperar ~60s a que el contenedor levante (Puppeteer + Chromium demoran)
   docker compose logs -f openwa  # verificar "Application is running on port 2785"
   ```

2. **Configurar el entorno de Comadre:**
   En el `.env` (o `.env.local`) de la raíz del proyecto, agregar:
   ```
   OPENWA_API_URL=http://localhost:3005
   OPENWA_API_KEY=dev-admin-key        # en modo dev; en prod leer de data/.api-key
   OPENWA_SESSION_ID=comadre
   OPENWA_WEBHOOK_SECRET=<32+ chars aleatorios>   # debe coincidir con el que se registra
   ```
   > **Nota:** En modo dev (`NODE_ENV !== production`), OpenWA siembra la clave `dev-admin-key` automáticamente. En producción, la clave real se guarda en `data/.api-key` dentro del contenedor.

3. **Levantar los servicios de Comadre:**
   ```bash
   pnpm run dev   # levanta apps/whatsapp en :3002, apps/agent en :3003, apps/api en :3001
   ```
   Al arrancar `apps/whatsapp`, el bootstrap (`openwaBootstrap.ts`) crea la sesión `comadre` en OpenWA y registra el webhook en `http://host.docker.internal:3002/webhooks/whatsapp`.

4. **Escanear el QR (primera ejecución):**
   En los logs de `apps/whatsapp` aparecerá una línea con el QR como data-URL:
   ```
   [openwaBootstrap] QR ready — data:image/png;base64,iVBORw...
   ```
   Copiá esa URL, pegála en el browser, y escaneá con el WhatsApp del número propietario de Comadre.

5. **Verificar autenticación:**
   Los logs mostrarán `session status: ready` (o `authenticating` mientras escanea). Una vez autenticado, enviar un mensaje de prueba al número para confirmar que llega al agente.

6. **Persistencia de sesión:**
   La sesión queda guardada en el volumen Docker `openwa-sessions`. Al hacer `docker compose restart`, la sesión se reanuda automáticamente sin nuevo QR, mientras WhatsApp no invalide la sesión.

### Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| Bootstrap loop en `qr_ready` sin QR en logs | Chromium no inició | `docker compose logs openwa` — buscar errores de Puppeteer |
| `status: disconnected` en los logs | WhatsApp invalidó la sesión | Borrar volumen: `docker volume rm openwa-sessions`, reiniciar, re-escanear |
| 403 en `POST /webhooks/whatsapp` | `OPENWA_WEBHOOK_SECRET` no coincide entre OpenWA y Comadre | Verificar que ambos lados usen el mismo valor en `.env` |
| `OpenWA not reachable` en logs de whatsapp | Contenedor OpenWA no está corriendo | `docker compose up -d` en `experimental/openwa/` |
| Mensajes llegan a OpenWA pero no al agente | `host.docker.internal` no resuelve | En Linux: agregar `--add-host host.docker.internal:host-gateway` al compose o usar la IP del host |
