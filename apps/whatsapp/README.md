# @comadre/whatsapp

Meta WhatsApp Cloud API webhook receiver + outbound reply service.

**Port:** 3002
**Routes:** `POST /webhook`, `POST /reply`

Maneja:
- Verificación de signature de Meta (`X-Hub-Signature-256`).
- Parse de eventos (text, audio, button_reply).
- 24h window state en Redis.
- Templates aprobados para outbound fuera de ventana.
- Bridge a `@comadre/agent` para respuestas.
