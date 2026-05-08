# @comadre/agent-tools

Tool definitions para Claude Sonnet 4.6.

**Reglas:**
1. Tools NUNCA firman tx — solo llaman API service.
2. Tools read-only no requieren `pending_signature`.
3. Tools de mutation devuelven `{ unsigned_tx }` para que el cliente firme.
4. Tx > $10 USDC requieren confirmación humana antes de enviar.

**Tools del MVP:**
- `consultar_perfil`
- `crear_tanda`, `unirse_tanda`, `consultar_tanda`
- `aportar_turno`
- `abrir_disputa`, `votar_disputa`
- `solicitar_kyc`, `iniciar_onramp`, `solicitar_offramp`
