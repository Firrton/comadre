# OpenWA Sandbox

**TEMPORARY — sandbox only. Will be replaced by Meta Cloud API. Do not deploy to production. Do not commit any session data.**

---

## What this is

A fully isolated local sandbox that runs [OpenWA](https://github.com/rmyndharis/OpenWA) (NestJS + `whatsapp-web.js`) in Docker. It lets the Comadre team test WhatsApp message sending and receiving locally without paying for the Twilio sandbox ($10/mo, shared number). It is a throwaway rig — when the migration to Meta Cloud API is complete, the whole `experimental/openwa/` directory gets deleted.

## Why it's isolated

This directory lives outside the Turborepo workspace list. The root `package.json` workspaces are explicit (`apps/*`, `packages/*`) and do not glob `experimental/`. Turbo, ESLint, TypeScript, and Bun will never pick up anything here. OpenWA's source code is never committed — the Dockerfile clones it at build time from GitHub.

## Quick start

```bash
# 1. Copy environment template and set API_MASTER_KEY
cp .env.example .env

# 2. Build and start (first build: 3-5 min — downloads Chromium)
./setup.sh

# 3. Start the service after setup
docker compose up -d

# 4. Watch logs and scan the QR code
docker compose logs -f openwa
```

## How to scan the QR code

The QR code prints to the container logs. Scan it with WhatsApp:

1. Open WhatsApp on your phone.
2. Go to **Settings > Linked Devices > Link a Device**.
3. Point the camera at the terminal QR code.

OpenWA also exposes a Swagger UI at `http://localhost:3005/api/docs` where you can browse all available endpoints after authentication.

## How to send a test message

Once linked, send a message via the REST API. Replace `<SESSION_ID>` with the session name shown in logs (typically `default`) and set your API key:

```bash
curl -X POST http://localhost:3005/api/messages/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <your-API_MASTER_KEY>" \
  -d '{
    "sessionId": "<SESSION_ID>",
    "to": "5491112345678@c.us",
    "message": "Hola desde el sandbox de Comadre"
  }'
```

The recipient number must include the country code and `@c.us` suffix. Use a number you control for testing.

## Where session data lives

WhatsApp auth is stored in the `openwa-sessions` Docker named volume. It is mounted at `/app/data/sessions` inside the container. The `sessions/` and `data/` local directories are gitignored as a fallback. **Never copy these files anywhere.** A stolen session file = full WhatsApp account takeover.

## How to bridge to `apps/agent` later

When you're ready to forward inbound OpenWA events to the Comadre agent, the pattern is: implement a small bridge service that subscribes to OpenWA's session webhook (`POST /api/sessions/<id>/webhooks`) and forwards normalized payloads to `apps/agent`'s existing `/webhooks/whatsapp` handler. A commented placeholder service (`bridge`) is already in `docker-compose.yml` — fill it in when the time comes. No code is needed here yet.

## How to remove

```bash
# Stop and remove containers + volumes
docker compose down -v --rmi local

# Delete the whole scaffold
cd ../.. && rm -rf experimental/openwa
```

That's it. Nothing in the monorepo depends on this directory.

## Migration path to Meta Cloud API

When ready, replace this sandbox with the official Meta Cloud API integration in `apps/whatsapp` (already in the workspace). Meta Cloud API is the production-safe path: webhook-based, no Chromium, no ban risk, and officially supported. OpenWA is explicitly a bridge while that integration is being planned. Follow the [Meta Cloud API getting started guide](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started) and delete this directory once `apps/whatsapp` is live.
