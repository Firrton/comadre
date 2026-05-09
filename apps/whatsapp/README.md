# @comadre/whatsapp

Twilio WhatsApp webhook receiver + outbound reply service. Bridge entre Twilio sandbox y `@comadre/agent`.

**Port:** 3002
**Stack:** Bun + Hono 4 + Twilio SDK
**Provider:** Twilio (NO Meta) — sandbox `whatsapp:+14155238886`
**Routes:** `GET /health`, `POST /webhook`, `POST /reply`

## Endpoints

### `POST /webhook` — Twilio inbound
- Verifica `X-Twilio-Signature` con `twilio.validateRequest(authToken, signature, url, params)`. URL debe ser EXACTAMENTE la configurada en Twilio dashboard (cloudflared/ngrok URL en dev).
- Parsea form-urlencoded de Twilio (`From`, `Body`, `MessageSid`, `ProfileName`, `WaId`, etc.)
- Forward a `apps/agent` (`POST {AGENT_URL}/process`) con `{ from, body, conversationKey: from }`
- Si agent responde con `{ reply }`, llama `sendWhatsAppMessage(from, reply)` para mandar al user
- Siempre devuelve TwiML vacío 200 (Twilio espera esto — outbound es REST API separado)

### `POST /reply` — internal HMAC-authed
- Header `X-Internal-Auth`: `createHmac("sha256", INTERNAL_HMAC_SECRET).update(body).digest("hex")` con `timingSafeEqual` comparison
- Body: `{ to: "whatsapp:+E164", body: string (1-4096) }`
- Llama `sendWhatsAppMessage(to, body)` y retorna `{ messageSid }`
- Lo usan `apps/api` (mensajes deferred a recipients no registrados) y `apps/cron` (recordatorios)

### `GET /health`
- Retorna `{ ok: true, service: "whatsapp" }`. No auth.

## Source layout

```
src/
├── index.ts                 ← Hono app + routes (entry point)
├── lib/
│   ├── sendMessage.ts       ← Twilio SDK wrapper
│   ├── twilioClient.ts      ← Singleton client con API Key SK auth
│   └── verifySignature.ts   ← Wrap de twilio.validateRequest
└── __tests__/
    └── index.test.ts        ← Health + signature 403 + auth 401
```

## Twilio auth model

Dos credenciales separadas:

| Var | Uso | Source |
|---|---|---|
| `TWILIO_AUTH_TOKEN` | Verificar inbound webhook signature **solamente** | Master token (rotar si se filtra) |
| `TWILIO_API_KEY_SID` (SK...) + `TWILIO_API_KEY_SECRET` | Outbound: enviar mensajes via `client.messages.create` | API Key scoped, rotatable sin tocar el account |

**No usar `TWILIO_AUTH_TOKEN` para outbound** (es el master token; si se compromete, todo el account está expuesto).

## Env vars

```
TWILIO_ACCOUNT_SID=AC...                  # account ID (público-ish)
TWILIO_AUTH_TOKEN=...                     # webhook signature verify ONLY
TWILIO_API_KEY_SID=SK...                  # outbound auth
TWILIO_API_KEY_SECRET=...                 # outbound auth
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886  # sandbox sender
WA_URL=https://<tunnel>.trycloudflare.com   # tunneled URL (Twilio reaches us here)
AGENT_URL=http://localhost:3003           # mismo bridge
INTERNAL_HMAC_SECRET=...                  # 32+ chars; shared con apps/api/cron
```

## Notas

- **24h window state** se maneja en `apps/agent` via `@comadre/cache.recordInbound/isWithinWindow` — NO en este servicio
- **Templates Twilio aprobados** son obligatorios para outbound fuera de la ventana 24h. Aprobación toma 24-48h en Twilio dashboard. Mientras estamos en sandbox: solo recipients que hicieron `join <código>` reciben mensajes
- **Cloudflare Tunnel** durante dev: `cloudflared tunnel --url http://localhost:3002` (la URL pública cambia en cada restart — actualizar `WA_URL` y el webhook setting en Twilio dashboard)

## Detalle adicional

Ver `docs/APPS.md` (sección `apps/whatsapp`) para flow de comunicación inter-servicios y `docs/FLOWS.md` (flujos #1-#3) para sequence diagrams Mermaid.
