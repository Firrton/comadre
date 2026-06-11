# @comadre/whatsapp

OpenWA webhook receiver + outbound reply service. Bridge between the OpenWA self-hosted WhatsApp container and `@comadre/agent`.

**Port:** 3002
**Stack:** Bun + Hono 4
**Provider:** OpenWA (self-hosted whatsapp-web.js bridge)
**Routes:** `GET /health`, `POST /webhooks/whatsapp`, `POST /reply`

## Endpoints

### `POST /webhooks/whatsapp` — OpenWA inbound
- Verifies `X-OpenWA-Signature` (HMAC-SHA256, `sha256=<hex>` format) keyed by `OPENWA_WEBHOOK_SECRET`. Bypassed in `NODE_ENV=test`.
- Parses JSON envelope (`{ event, sessionId, data: { id, from, body, type, fromMe, isGroup } }`).
- Filter pipeline: signature → JSON validate → event type → fromMe/group/self-loop → type → rate limit → dedup → normalize JID → forward to agent.
- Forwards to `apps/agent` (`POST {AGENT_URL}/process`) with `{ from, body, conversationKey: from }` (HMAC-signed).
- If agent responds with `{ reply }`, calls `sendWhatsAppMessage(from, reply)` — wrapped in try/catch so outbound failure never blocks the inbound ack.
- Always returns `{ ok: true }` (200) to OpenWA.

### `POST /reply` — internal HMAC-authed
- Headers: `X-Internal-Signature` (timestamped HMAC-SHA256), `X-Internal-Timestamp`.
- Body: `{ to: "whatsapp:+E164", body: string (1-4096) }`.
- Calls `sendWhatsAppMessage(to, body)` and returns `{ messageId }` on success, `502` on `OpenWaSendError`.
- Used by `apps/api` (deferred messages, nudges) and `apps/cron` (reminders).

### `GET /health`
- Returns `{ ok: true, service: "whatsapp" }`. No auth.

## Source layout

```
src/
├── index.ts                   ← Hono app + routes (entry point) + bootstrap call
├── lib/
│   ├── openwaClient.ts        ← OpenWA REST client: sendText(), OpenWaSendError taxonomy
│   ├── sendMessage.ts         ← sendWhatsAppMessage() + toChatId() address conversion
│   ├── openwaInbound.ts       ← Zod envelope schema + verifyOpenWaSignature()
│   ├── openwaBootstrap.ts     ← Idempotent session + webhook bootstrap (startup module)
│   └── jid.ts                 ← JID normalization: jidToWhatsAppAddress(), isIndividualJid()
└── __tests__/
    ├── index.test.ts          ← Health + filter pipeline + /reply HMAC auth
    ├── openwaInbound.test.ts  ← Signature verification + envelope schema
    ├── jid.test.ts            ← JID normalization unit tests
    ├── sendMessage.test.ts    ← toChatId conversion + error taxonomy propagation
    └── openwaBootstrap.test.ts ← Idempotency, unknown status, health-unreachable
```

## OpenWA auth model

| Var | Usage |
|---|---|
| `OPENWA_API_KEY` | `X-API-Key` header for all OpenWA REST calls (outbound send + bootstrap). Dev mode: `dev-admin-key`. |
| `OPENWA_WEBHOOK_SECRET` | HMAC-SHA256 secret for verifying `X-OpenWA-Signature` on inbound deliveries. Distinct from `INTERNAL_HMAC_SECRET`. |
| `INTERNAL_HMAC_SECRET` | HMAC for internal `/reply` auth (apps/api → apps/whatsapp). Unchanged from previous provider. |

## Env vars

```
OPENWA_API_URL=http://localhost:3005       # OpenWA container REST API (host-side)
OPENWA_API_KEY=dev-admin-key              # X-API-Key (dev mode value)
OPENWA_SESSION_ID=comadre                 # Session name registered with OpenWA
OPENWA_WEBHOOK_SECRET=<32+ chars>         # Inbound HMAC secret (X-OpenWA-Signature)
OPENWA_WEBHOOK_URL=http://host.docker.internal:3002/webhooks/whatsapp  # bootstrap default
WA_URL=http://localhost:3002              # Self-referential for /reply callers
AGENT_URL=http://localhost:3003           # Agent service
INTERNAL_HMAC_SECRET=<32+ chars>         # Shared with apps/api and apps/cron
```

## Session bootstrap

On startup (`NODE_ENV !== "test"`), `bootstrapOpenWa()` runs once:
1. Health-checks the OpenWA container.
2. Creates + starts the session if it doesn't exist.
3. Logs QR data-URL if status is `qr_ready` (operator scans in browser).
4. Idempotently registers the `message.received` webhook pointing at `OPENWA_WEBHOOK_URL`.

All failures are swallowed — the service still starts and serves `/health`/`/reply` while OpenWA comes up.

## Notes

- **Canonical user id** stays `whatsapp:+E164` — zero Redis key migration needed.
- **JID normalization** (`@c.us` → `whatsapp:+E164`) happens in `jid.ts`. The `+` prefix is mandatory — `resolveUserFromPhone` rejects bare E164 without it.
- **Session security:** The `openwa-sessions` Docker volume contains WhatsApp session credentials. Never copy, commit, or include in a Docker image. A stolen session equals a full account takeover.

## Additional detail

See `docs/APPS.md` (section `apps/whatsapp`) and `docs/FLOWS.md` for inter-service communication flows.
