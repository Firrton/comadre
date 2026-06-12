# @comadre/agent

Conversational orchestrator del bot. Implementa tool-use loop contra **Kimi K2** (Moonshot directo o Groq) usando el SDK OpenAI-compatible. Recibe mensajes de `apps/whatsapp`, llama tools de `@comadre/agent-tools`, persiste history en Redis. **Nunca firma transacciones** — esa responsabilidad es de `apps/api` (Privy server-side).

**Port:** 3003
**Stack:** Bun + Hono 4 + OpenAI SDK (apuntado a Moonshot/Groq baseURL)
**LLM:** Kimi K2 (`kimi-k2.6` Moonshot, o `moonshotai/kimi-k2-instruct` en Groq)
**Routes:** `GET /health`, `POST /process`

## Endpoints

### `POST /process` — agent invocation
Body:
```json
{ "from": "whatsapp:+5218116346072", "body": "manda 10 USDC al +52...", "conversationKey": "whatsapp:+5218116346072" }
```

Flow del handler:
1. **Resolve user** via `resolveUserFromPhone(from)` — DB primary lookup por phone_hash
   - `null` → unregistered (tool-use loop solo permite `iniciar_onboarding`)
   - `{ wallet, ... }` → registered, todas las tools disponibles
2. **Load history** desde Redis (`agent:conv:{conversationKey}`, TTL 24h, max 20 msgs)
3. **Run tool-use loop** (`runAgent`):
   - Append user message + history + system prompt
   - Llama Moonshot/Groq con `tools: ALL_TOOLS` (14 tools registradas)
   - Si responde `tool_calls`: ejecutar cada uno via `executeTool(name, args, ctx)` de `@comadre/agent-tools`, append `role: "tool"` message, loop
   - Max **5 iteraciones** (`MAX_TOOL_ITERATIONS=5`); fallback message si se exhausts
4. **Persist** new messages en Redis
5. Return `{ reply }` para que `apps/whatsapp` lo mande al user

### `GET /health`
- Retorna estado básico. No auth.

## Source layout

```
src/
├── index.ts                  ← Hono app + /process endpoint (entry)
├── agentLoop.ts              ← runAgent() — tool-use loop con Moonshot
├── userResolver.ts           ← resolveUserFromPhone(): phone → wallet via DB
├── lib/
│   ├── moonshotClient.ts     ← OpenAI client con baseURL Moonshot/Groq
│   ├── conversationStore.ts  ← loadHistory/saveHistory en Redis
│   └── systemPrompt.ts       ← persona "tía LATAM" + tool-use rules + onboarding
└── __tests__/
    └── index.test.ts         ← health + validation
```

## System prompt (resumen)

El prompt define:
- **Persona**: tía cariñosa pero firme con la plata, español LATAM neutral
- **Brevity**: max 2-3 sentences por reply (UX WhatsApp)
- **Reglas de transferencia**: SIEMPRE confirmar con phone + walletPreview + amount antes de `confirmar_transfer`
- **Onboarding**: si user sin wallet (UNREGISTERED tool error), pedir consentimiento explícito antes de llamar `iniciar_onboarding`
- **Tone-by-country**: "vos" o "tú" según país detectado (México=tú, Argentina=vos)

Ver `src/lib/systemPrompt.ts` para el texto completo.

## Tool-use whitelist sin wallet

Cuando `userWallet === null` (user no registrado), las tools comunes devuelven error `UNREGISTERED`. Solo hay una tool whitelisted:

```ts
const TOOLS_ALLOWED_WITHOUT_WALLET = new Set(["iniciar_onboarding"]);
```

El system prompt instruye al modelo a llamar `iniciar_onboarding` solo después de consentimiento explícito del user (no automáticamente al primer mensaje).

## Tools disponibles (14 totales — registradas en `@comadre/agent-tools`)

**Read-only**: `consultar_perfil`, `consultar_tanda`, `consultar_balance`
**Tx-building tandas**: `crear_tanda`, `unirse_tanda`, `aportar_turno`, `abrir_disputa`, `votar_disputa`
**P2P transfers**: `iniciar_transfer`, `confirmar_transfer`, `cancelar_transfer`
**Onboarding**: `iniciar_onboarding`, `solicitar_kyc`, `iniciar_onramp`

Todas hacen calls a `apps/api` con HMAC-SHA256 (`X-Internal-Signature`). El agent NUNCA firma tx — eso es server-side via Privy en `apps/api`.

## Env vars

```
LLM_PROVIDER=moonshot              # o "groq"
MOONSHOT_API_KEY=...               # required si LLM_PROVIDER=moonshot
GROQ_API_KEY=...                   # required si LLM_PROVIDER=groq
KIMI_MODEL=kimi-k2.6               # Moonshot model name (kimi-k2.5 y kimi-k2.6 son los IDs reales expuestos por /v1/models; kimi-k2-0905-preview NO existe en Moonshot). Para Groq: moonshotai/kimi-k2-instruct

UPSTASH_REDIS_REST_URL=...         # conversation history
UPSTASH_REDIS_REST_TOKEN=...

API_URL=http://localhost:3001      # para que las tools llamen apps/api
INTERNAL_HMAC_SECRET=...           # 32+ chars; shared con apps/api
```

## Quirks de Kimi/Moonshot

- **Temperature**: K2.5/K2.6 son reasoning models y Moonshot rechaza cualquier valor distinto de 1 con `400 invalid temperature: only 1 is allowed for this model`. `agentLoop.ts` ya usa un condicional: `KIMI_MODEL.startsWith("kimi-k2.") ? 1 : 0.3`.
- **max_tokens**: 4000 da headroom a reasoning models; non-reasoning usan menos
- **Latencia**: K2.6 (reasoning model) tarda ~10s por turno en Moonshot — es normal para este modelo, no indica un bug. Modelos no-reasoning son 800-2500ms. Groq es más rápido pero hay rate limits.

## Observaciones

- Si Kimi devuelve `content` vacío sin `tool_calls`, se tira error con `finish_reason` para diagnosticar (puede ser truncation por `max_tokens` bajo)
- Tool calls con args JSON malformados se interceptan: se devuelve `ToolResult.error` para que el modelo pueda recover
- Tool calls type !== "function" se rechazan (Moonshot solo emite `function` por ahora)

## Detalle adicional

Ver `docs/APPS.md` (sección `apps/agent`) para detalles de middleware/dependency stack y `docs/FLOWS.md` (flujos #1-#3) para sequence diagrams completos.
