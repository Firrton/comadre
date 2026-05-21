# Comadre — End-to-end flows

> Sequence diagrams Mermaid de los flujos críticos. Para detalles de cada servicio ver `APPS.md`. Para detalles del modelo de datos ver `DATA_MODEL.md`.

> **Phase 1 — Monad migration (2026-05-20)**: los diagramas abajo todavía describen el flujo Solana legacy. La arquitectura actual usa **Monad + Privy + Turnkey + Kernel v3.1 + Pimlico bundler**. Los flujos canónicos se documentan en `ARCHITECTURE.md` → "Tx signing flow (Monad + Turnkey)" hasta que estos diagramas se reescriban en Phase 2.

## TOC

1. [Phone-to-phone USDC transfer (immediate)](#1-p2p-usdc-immediate)
2. [Phone-to-phone USDC transfer (deferred — recipient sin registrar)](#2-p2p-usdc-deferred)
3. [Onboarding (primer mensaje WA → wallet creada)](#3-onboarding)
4. [Tanda lifecycle (create → join → start → contribute → payout × N → complete)](#4-tanda-lifecycle)
5. [Dispute resolution](#5-dispute-resolution)
6. [Guardadito — depositar (Neverland)](#6-guardadito-depositar)
7. [Guardadito — retirar con fee collection (Neverland)](#7-guardadito-retirar)
8. [Guardadito — consultar balance](#8-guardadito-consultar)

---

## 1. P2P USDC immediate

### Pre-condiciones

- Sender **y** recipient ambos registrados (`users.phone_hash → wallet`).
- Sender tiene ≥ `amountUsdc` USDC en su ATA devnet.
- Sender tiene Privy embedded Solana wallet activa (credencial en Privy).

### Sequence

```mermaid
sequenceDiagram
  participant U as User (sender) WhatsApp
  participant TW as Twilio
  participant W as apps/whatsapp :3002
  participant A as apps/agent :3003
  participant K as Moonshot/Kimi K2
  participant R as Redis (Upstash)
  participant API as apps/api :3001
  participant DB as Postgres
  participant P as Privy
  participant SOL as Solana devnet

  U->>TW: "mandá 10 USDC al +52..."
  TW->>W: POST /webhook (form-urlencoded, X-Twilio-Signature)
  W->>W: verifyTwilioSignature (HMAC-SHA1 sobre TWILIO_AUTH_TOKEN)
  W->>A: POST /process { from, body, conversationKey }
  A->>DB: resolveUserFromTwilio(from) → SELECT users WHERE phone_hash
  DB-->>A: { wallet: "sender-wallet" }
  A->>R: loadHistory(conversationKey) → ChatMessage[]
  A->>K: chat.completions.create(system+history+userMsg, tools=ALL_TOOLS)
  K-->>A: tool_calls=[{ name: "iniciar_transfer", args: { toPhone, amountUsdc } }]
  A->>API: POST /api/v1/transfers (body, X-Idempotency-Key)
  API->>DB: SELECT users WHERE wallet = sender
  API->>API: lookupByPhone(toPhone) → SELECT users WHERE phone_hash
  API->>API: enforceKycLimit(tier, microUsdc)
  API->>API: buildUsdcTransferIxs(from, to, amount, mint, payer)
  API->>API: buildUnsignedTx({ instructions, payer: fee_payer })
  API->>DB: INSERT transfers { status: pending, expiresAt: now+5min }
  API->>R: SET transfer:tx:{id} = unsignedTxBase64 TTL 300s
  API-->>A: { transferId, recipient: { wallet }, unsignedTxBase64 }
  A->>R: saveHistory(conversationKey, newMessages)
  A->>K: chat.completions.create con tool result
  K-->>A: "Confirmás 10 USDC a wallet ...J4yX? (sí / no)"
  A-->>W: { reply: "Confirmás...?" }
  W->>TW: REST API send WhatsApp message
  TW-->>U: "Confirmás 10 USDC a ...J4yX?"

  U->>TW: "sí"
  TW->>W: POST /webhook
  W->>A: POST /process
  A->>R: loadHistory
  A->>K: chat.completions.create
  K-->>A: tool_calls=[{ name: "confirmar_transfer", args: { transferId } }]
  A->>API: POST /api/v1/transfers/:id/confirm
  API->>DB: SELECT transfers WHERE id (validar owner, status=pending, expiresAt)
  API->>R: GET transfer:tx:{id} → unsignedTxBase64
  API->>API: VersionedTransaction.deserialize(base64)
  API->>P: walletApi.solana.signTransaction({ walletId, transaction })
  P-->>API: { signedTransaction }
  API->>SOL: submitWithRetry(signedTx)
  SOL-->>API: { signature }
  API->>DB: UPDATE transfers SET status=confirmed, tx_signature, confirmed_at
  API->>R: DEL transfer:tx:{id}
  API-->>A: { signature, explorerUrl }
  A->>K: chat.completions.create con tool result
  K-->>A: "Listo, 10 USDC enviados. Tx: ..."
  A->>R: saveHistory
  A-->>W: { reply }
  W->>TW: send
  TW-->>U: "Listo, 10 USDC enviados."
```

### Latencia esperada

| Paso | Tiempo típico |
|---|---|
| Webhook → agent → Kimi (primera llamada) | 2-4 s |
| API buildUnsignedTx | 300-600 ms |
| Kimi segunda llamada (respuesta confirmación) | 1-2 s |
| Privy server-sign | 500-800 ms |
| Solana submitWithRetry | 1-3 s |
| **Total flow completo (2 mensajes)** | **5-12 s** |

### Errores comunes

| Error | Causa | Cómo se manifiesta |
|---|---|---|
| `SELF_TRANSFER` | `recipient.wallet === sender.walletAddress` | "no te podés mandar plata a vos misma, mija" |
| `KYC_LIMIT_EXCEEDED` | `amount > kyc_limits[tier]` | "tu nivel KYC permite hasta $X USDC por tx" |
| `EXPIRED` (409) | Redis TTL expiró (>5 min entre init y confirm) | "Tx blockhash expired; please retry" |
| `PRIVY_SIGN_FAILED` (502) | `walletId` incorrecto o Privy 5xx | status=failed persistido en DB |
| `BROADCAST_FAILED` (502) | RPC caído o SOL insuficiente en fee_payer | status=failed persistido en DB |
| `USER_NOT_FOUND` (404) | Sender no registrado en DB | "Hacé KYC primero" |

---

## 2. P2P USDC deferred

### Pre-condiciones

- Sender **registrado** en Comadre.
- Recipient **NO registrado** (phone_hash no existe en `users`).
- Sender tiene Privy embedded wallet activa.

### Sequence

```mermaid
sequenceDiagram
  participant U as User (sender) WhatsApp
  participant TW as Twilio
  participant W as apps/whatsapp :3002
  participant A as apps/agent :3003
  participant K as Moonshot/Kimi K2
  participant API as apps/api :3001
  participant R as Redis (Upstash)
  participant DB as Postgres
  participant REC as Recipient WhatsApp

  U->>TW: "mandá 20 USDC al +52-nuevo..."
  TW->>W: POST /webhook
  W->>A: POST /process { from, body }
  A->>DB: resolveUserFromTwilio → { wallet: sender }
  A->>R: loadHistory
  A->>K: chat.completions.create(tools=ALL_TOOLS)
  K-->>A: tool_calls=[{ name: "iniciar_transfer", args }]
  A->>API: POST /api/v1/transfers
  API->>API: lookupByPhone(toPhone) → { registered: false, phoneHash }
  API->>DB: INSERT transfers { status: awaiting_recipient, expiresAt: now+7d }
  API->>W: POST /reply { to: "whatsapp:+52nuevo", body: "Alguien te quiere mandar..." } (HMAC)
  W->>TW: REST API send to recipient
  TW-->>REC: "Alguien te quiere mandar 20 USDC. Escribime 'aceptar'"
  API-->>A: { mode: "deferred", transferId, expiresAt }
  A->>K: chat.completions con tool result
  K-->>A: "Le mandé un mensaje al destinatario. Tiene 7 días para aceptar."
  A-->>W: { reply }
  W->>TW: send
  TW-->>U: "Le avisé al destinatario..."

  Note over REC,DB: Recipient onboards (ver flow 3)

  REC->>TW: "aceptar"
  TW->>W: POST /webhook (from: recipient)
  W->>A: POST /process
  A->>DB: resolveUserFromTwilio → null (aún no registrado)
  A->>R: loadHistory(recipient conversation)
  A->>K: chat.completions.create
  K-->>A: tool_calls=[{ name: "iniciar_onboarding", args: { phone } }]
  Note over A,DB: Onboarding completo (ver flow 3)...
  Note over U,DB: Una vez registrado, agent re-prompts sender para confirmar la transferencia deferred pendiente
```

### Latencia esperada

- Creación deferred: 1-3 s (sin tx on-chain)
- WA best-effort a recipient: 1-2 s adicionales
- Expiración: 7 días

### Errores comunes

| Error | Causa | Cómo se manifiesta |
|---|---|---|
| WA send a recipient falla | `/reply` 5xx (best-effort) | Transfer row igualmente creada; sender puede reintentarlo |
| `EXPIRED` al confirmar posterior | Han pasado >7 días sin onboarding del recipient | status=expired; sender debe reiniciar |
| Recipient onboards pero tx ya expiró | Race condition | El agente informa que hay una tx pendiente expirada; sender retransfer |

---

## 3. Onboarding

### Pre-condiciones

- Phone manda su primer mensaje a Comadre.
- `resolveUserFromTwilio` retorna `null` (no existe en `users`).
- El modelo Kimi decide llamar `iniciar_onboarding` (único tool permitido sin wallet).

### Sequence

```mermaid
sequenceDiagram
  participant U as New User WhatsApp
  participant TW as Twilio
  participant W as apps/whatsapp :3002
  participant A as apps/agent :3003
  participant K as Moonshot/Kimi K2
  participant R as Redis (Upstash)
  participant API as apps/api :3001
  participant P as Privy
  participant DB as Postgres
  participant SOL as Solana devnet

  U->>TW: "hola, quiero unirme a una tanda"
  TW->>W: POST /webhook (X-Twilio-Signature)
  W->>A: POST /process { from: "whatsapp:+52...", body, conversationKey }
  A->>DB: resolveUserFromTwilio(from) → null
  A->>R: loadHistory(conversationKey) → []
  A->>K: chat.completions.create(system, userMsg, tools=ALL_TOOLS, userWallet=null)
  K-->>A: content: "Hola! Para empezar necesito registrarte. ¿Puedo crear tu cuenta?"
  A->>R: saveHistory
  A-->>W: { reply: "Hola! Para empezar..." }
  W->>TW: send
  TW-->>U: "Hola! Para empezar..."

  U->>TW: "sí, registrame"
  TW->>W: POST /webhook
  W->>A: POST /process
  A->>DB: resolveUserFromTwilio → null (still)
  A->>R: loadHistory
  A->>K: chat.completions.create
  K-->>A: tool_calls=[{ name: "iniciar_onboarding", args: { phone: "+52..." } }]
  A->>API: POST /api/v1/users/onboard { phone }
  API->>P: privy.importUser({ linkedAccounts: [{ type: "phone", number: phone }] })
  P-->>API: { privyUserId, embeddedWallet: { address, id } }
  API->>API: build init_user_profile instruction (phone_hash, country_code)
  API->>API: buildUnsignedTx + signWithPrivy (fee_payer partial-sign)
  API->>SOL: submitWithRetry(signedTx init_user_profile)
  SOL-->>API: { signature }
  API->>DB: INSERT users { wallet, phone_hash, kyc_tier: T0Demo, privy_user_id }
  API-->>A: { wallet, privyUserId, txSignature }
  A->>K: chat.completions con tool result
  K-->>A: "Tu cuenta fue creada. Tu wallet: ...J4yX. Ya podés usar Comadre."
  A->>R: saveHistory
  A-->>W: { reply }
  W->>TW: send
  TW-->>U: "Tu cuenta fue creada..."
```

### Latencia esperada

| Paso | Tiempo típico |
|---|---|
| Privy importUser | 500-1000 ms |
| init_user_profile on-chain | 1-3 s |
| Total (turno de confirmación) | 3-6 s |

### Errores comunes

| Error | Causa | Cómo se manifiesta |
|---|---|---|
| `UNREGISTERED` tool blocked | Kimi intentó llamar otro tool antes de onboarding | Kimi recibe error interno y re-solicita consentimiento |
| Privy importUser falla | Phone inválido o Privy 5xx | 502; agente responde "no pude crear tu cuenta, intentá de nuevo" |
| `init_user_profile` falla | `phone_hash` vacío o `country_code` inválido | 500; log detallado; onboarding no persistido |
| DB INSERT duplicado | Race condition (dos mensajes casi simultáneos) | `ON CONFLICT DO NOTHING` o unique index en `phone_hash` |

---

## 4. Tanda lifecycle

### Pre-condiciones

- Creator y todos los members ya onboarded (KYC tier ≥ T1Lite para creator).
- Todos tienen USDC devnet suficiente para `stake_amount`.
- Programa Anchor desplegado, `init_config` ejecutado.

### Sequence

```mermaid
sequenceDiagram
  participant CR as Creator (wallet)
  participant M1 as Member 1
  participant M2 as Member 2
  participant Mn as Member N
  participant API as apps/api :3001
  participant SOL as Solana devnet
  participant CRN as apps/cron (payoutCrank)
  participant DB as Postgres

  CR->>API: POST /api/v1/tandas { name, memberTarget:5, contributionAmount, stakeAmount, frequencySeconds }
  API->>SOL: create_tanda ix (Tanda PDA + Vault PDA init)
  SOL-->>API: { signature, tandaPda, vaultPda }
  API->>DB: INSERT tandas { tanda_pda, state: forming }
  API-->>CR: { tandaId, tandaPda, inviteCode }

  M1->>API: POST /api/v1/tandas/:id/join { turnNumber? }
  API->>SOL: join_tanda ix (Member PDA init, stake USDC → vault)
  SOL-->>API: { signature }
  API->>DB: INSERT members { tanda_id, wallet, turn_number, stake_locked }
  API-->>M1: { memberId, assignedTurn }

  M2->>API: POST /api/v1/tandas/:id/join
  API->>SOL: join_tanda ix
  SOL-->>API: { signature }

  Mn->>API: POST /api/v1/tandas/:id/join
  API->>SOL: join_tanda ix (5th member — tanda full)
  SOL-->>API: { signature }

  CR->>API: POST /api/v1/tandas/:id/start
  API->>SOL: start_tanda ix (validates member_current == member_target)
  SOL-->>API: { signature } Note: state → Active, current_turn=1, next_payout_ts=now+freq
  API->>DB: UPDATE tandas SET state=active, started_at

  Note over M1,SOL: Turn 1 — todos contribuyen

  M1->>API: POST /api/v1/tandas/:id/contribute
  API->>SOL: contribute ix (USDC user_ata → vault, contributions_this_turn++)
  SOL-->>API: { signature }

  M2->>API: POST /api/v1/tandas/:id/contribute
  API->>SOL: contribute ix

  Mn->>API: POST /api/v1/tandas/:id/contribute
  API->>SOL: contribute ix (5th contribution, contributions_this_turn == member_target)

  Note over CRN,SOL: Cron job payoutCrank — cada 5 min

  CRN->>SOL: payout ix (crank_authority signer, beneficiary_member = turn 1 member)
  Note over SOL: vault → beneficiary_ata (N × contribution_amount), advance current_turn, reset contributions_this_turn
  SOL-->>CRN: { signature }
  CRN->>DB: UPDATE tandas SET current_turn=2, members SET has_received_payout=true for turn 1

  Note over M1,CRN: Turns 2..N — mismo ciclo contribute × N → payoutCrank

  Note over CRN,SOL: After last payout (turn N), payout ix sets state=Completed internally

  CRN->>SOL: complete_tanda ix (safety-confirm, crank_authority)
  SOL-->>CRN: { signature } Note: state idempotently Completed
  CRN->>DB: UPDATE tandas SET state=completed, completed_at
```

### Latencia esperada

| Operación | Tiempo típico |
|---|---|
| create_tanda (2 PDAs init) | 2-4 s |
| join_tanda (stake SPL transfer) | 1-3 s por member |
| start_tanda | 1-2 s |
| contribute (SPL transfer) | 1-2 s |
| payout (crank → SPL transfer N×) | 2-4 s |
| complete_tanda | 1-2 s |

### Errores comunes

| Error | Causa | Cómo se manifiesta |
|---|---|---|
| `InsufficientKyc` en create | Creator tier < T1Lite | 400 del API, Kimi informa al user |
| `TandaFull` en join | `member_current == member_target` | 400; ya no hay cupo |
| `InvalidMemberCount` en start | Falta algún member | 400; "esperá que se unan todos" |
| `NotImplemented` en start | `payout_order_mode != JoinOrder` | MVP solo soporta JoinOrder |
| `AlreadyContributed` en contribute | Member llamó contribute dos veces en el mismo turn | 400 on-chain |
| `MissingContributions` en payout | No todos contribuyeron antes del crank | Cron reintenta hasta cumplido |
| `PayoutNotReady` en payout | `now < next_payout_ts` | Cron respeta la ventana temporal |

---

## 5. Dispute resolution

### Pre-condiciones

- Tanda en estado `Active`.
- Opener es un member activo de la tanda.
- `disputes_opened < MAX_DISPUTES_PER_TANDA`.

### Sequence

```mermaid
sequenceDiagram
  participant OP as Opener (member)
  participant M1 as Member 1
  participant M2 as Member 2
  participant API as apps/api :3001
  participant SOL as Solana devnet
  participant CRN as apps/cron (disputeResolveCrank)
  participant DB as Postgres

  OP->>API: POST /api/v1/tandas/:id/disputes { reason }
  API->>API: hash(reason) → reason_hash [u8;32]
  API->>SOL: open_dispute ix (Dispute PDA init, tanda.state → Paused)
  SOL-->>API: { signature, disputePda }
  API->>DB: INSERT disputes { tanda_id, dispute_pda, state: open, deadline_ts: now+7d }
  API-->>OP: { disputeId, disputePda, deadlineTs }

  Note over OP,SOL: Tanda queda en Paused — contribute y payout rechazados

  M1->>API: POST /api/v1/disputes/:id/vote { continueTanda: true }
  API->>SOL: vote_dispute ix (DisputeVote PDA init — PDA enforces 1 vote/voter)
  SOL-->>API: { signature }

  M2->>API: POST /api/v1/disputes/:id/vote { continueTanda: false }
  API->>SOL: vote_dispute ix

  Note over CRN,SOL: After deadline_ts (7 days) — cron disputeResolveCrank

  CRN->>SOL: resolve_dispute ix (anyone puede llamarlo post-deadline)
  Note over SOL: votes_continue > votes_cancel → tanda.state = Active
  Note over SOL: empate o votes_cancel >= votes_continue → tanda.state = Cancelled
  SOL-->>CRN: { signature }
  CRN->>DB: UPDATE disputes SET state=resolved, UPDATE tandas SET state=active|cancelled
  CRN->>DB: Notify members via scheduled WA reminder job
```

### Latencia esperada

| Paso | Tiempo típico |
|---|---|
| open_dispute (PDA init) | 1-3 s |
| vote_dispute (PDA init) | 1-2 s por voto |
| resolve_dispute (post-deadline) | 1-2 s |
| Ventana de votación | 7 días (DISPUTE_VOTING_WINDOW_SECONDS) |

### Errores comunes

| Error | Causa | Cómo se manifiesta |
|---|---|---|
| `TandaNotActive` al abrir dispute | Tanda ya Paused o Completed | 400; no se pueden abrir disputes en ese estado |
| `MaxDisputesReached` | `disputes_opened >= MAX_DISPUTES_PER_TANDA` | 400 |
| `AccountAlreadyInitialized` en vote | Member intenta votar dos veces | Anchor rechaza — DisputeVote PDA ya existe |
| `DisputeExpired` en vote | `now > deadline_ts` | 400; ventana de votación cerrada |
| `DisputeNotExpired` en resolve | Cron corrió antes del deadline | Instrucción rechazada; cron reintenta |
| Tanda → Cancelled por empate | `votes_cancel >= votes_continue` | Members deben reclamar stakes via `claim_stake` (pendiente de implementar) |

---

## Flujos custodial (post-pivot)

### Onboarding (primer consentimiento)

Disparado cuando un user sin fila en DB manda su primer "sí".

```
WhatsApp "sí"
     │
     ▼
comadre-whatsapp
  valida firma Twilio
     │
     ▼
comadre-agent
  toolsForWalletState(null)  ← wallet no en DB
  → iniciar_onboarding en toolset
  LLM llama tool: iniciar_onboarding
     │
     ▼
comadre-api  POST /api/v1/onboarding/init
  1. Keypair.generate()
  2. INSERT user_keypairs (wallet, secret_key_b58)
  3. INSERT users (wallet, phone_hash, kyc_tier=t0_demo)
  4. airdrop 0.05 SOL  fee_payer → user wallet
  5. Anchor: init_user_profile  payer=fee_payer
  6. Anchor: update_kyc_tier(t1Lite)  signer=kyc_oracle
  7. UPDATE users SET kyc_tier='t1_lite'
     │
     ▼
  return { walletAddress, kyc_tier: 't1_lite' }
     │
     ▼
LLM responde con bienvenida al user
```

Después del onboarding, `toolsForWalletState(wallet)` excluye `iniciar_onboarding` en todos los turnos siguientes.

### Crear tanda

```
WhatsApp "creá una tanda Demo de 3 personas, 10 USDC por semana"
     │
     ▼
comadre-agent  LLM llama tool: crear_tanda({ name, member_target, contribution_amount_cents, frequency_days, payout_order_mode })
     │
     ▼
comadre-api  POST /api/v1/tandas
  1. buildCreateTandaIx
       creator   = user.wallet (PubKey)
       name_hash = SHA-256(name)
       amount    = new BN(amount_atomic_usdc)
  2. construye Anchor create_tanda ix
  3. fee_payer pre-firma (paga rent + fees)
  4. signWithUserKeypair(creator) ← backend firma como user
  5. submitWithRetry(tx)
  6. INSERT tandas (id=tanda_pda, creator_wallet, ...)
     │
     ▼
  return { tanda_id, signature, explorer_url }
     │
     ▼
crearTandaExecute → { type: "data", data: { ... } }
     │
     ▼
LLM (regla "REGLAS CUANDO UNA TOOL DEVUELVE DATOS REALES"):
  - relayea explorer_url al user
  - presenta tanda_id[0..7] como código corto de invitación
```

### Unirse a tanda

```
WhatsApp "quiero unirme a la tanda 8jK8UsMv..."
     │
     ▼
comadre-agent  LLM llama tool: unirse_tanda({ tanda_id })
     │
     ▼
comadre-api  POST /api/v1/tandas/:id/join
  1. buildJoinTandaIx
     a. createAssociatedTokenAccountInstruction
          para el ATA USDC del user (si no existe)
     b. Anchor join_tanda ix
          signer = user.wallet
  2. fee_payer pre-firma
  3. signWithUserKeypair(user.wallet)
  4. submitWithRetry(tx)
  5. INSERT members + UPDATE tandas.member_current
     │
     ▼
  return { tanda_id, member, signature, explorer_url }
     │
     ▼
LLM relayea confirmación + explorer_url
```

---

## 6. Guardadito — depositar (Neverland)

### Pre-condiciones

- Usuario registrado y con session key que incluye políticas Neverland.
- Tiene USDC en su Kernel wallet (mínimo 1 USDC).

### Sequence

```mermaid
sequenceDiagram
  participant U as Usuario WhatsApp
  participant TW as Twilio
  participant W as apps/whatsapp :3002
  participant A as apps/agent :3003
  participant K as Moonshot/Kimi K2
  participant R as Redis (Upstash)
  participant API as apps/api :3001
  participant DB as Postgres
  participant TK as Turnkey HSM
  participant PIM as Pimlico bundler
  participant NV as Neverland Pool (Monad)

  U->>TW: "guardá 50 USDC en mi chanchito"
  TW->>W: POST /webhook (X-Twilio-Signature)
  W->>A: POST /process { from, body, conversationKey }
  A->>DB: resolveUserFromTwilio(from) → { wallet }
  A->>R: loadHistory(conversationKey)
  A->>K: chat.completions.create(system+history+userMsg, tools)
  K-->>A: tool_calls=[{ name: "preparar_guardadito", args: { amountUsdc: 50 } }]
  A->>API: POST /api/v1/savings/deposit { amountMicroUsdc: 50_000_000 }
  API->>DB: SELECT session_keys WHERE wallet (recupera subOrgId + walletId + permission)
  API->>API: Verifica amount >= 1_000_000 (mínimo 1 USDC)
  API->>API: Construye UserOp con 2 calls:<br/>1. USDC.approve(neverlandPool, 50 USDC)<br/>2. NeverlandPool.supply(usdc, 50 USDC, kernelWallet, 0)
  API->>TK: signEvmPayload({ subOrgId, walletId, userOpDigest })
  TK-->>API: firma (Turnkey verifica policies de session key)
  API->>PIM: eth_sendUserOperation (UserOp firmado)
  PIM->>NV: ejecuta approve + supply en Kernel del usuario
  NV-->>PIM: nUSDC emitido al Kernel wallet del usuario
  PIM-->>API: { userOpHash, txHash }
  API->>DB: UPSERT savings_positions { provider: neverland, deposited_micro_usdc += 50_000_000 }
  API-->>A: { status: confirmed, txHash, depositedMicroUsdc: 50_000_000 }
  A->>K: chat.completions.create con tool result
  K-->>A: "Listo mija, guardé 50 USDC en tu chanchito. Están trabajando para vos al ~13% anual."
  A->>R: saveHistory
  A-->>W: { reply }
  W->>TW: send
  TW-->>U: "Listo mija, guardé 50 USDC..."
```

### Errores comunes

| Error | Causa | Cómo se manifiesta |
|---|---|---|
| `503` en deposit | `NEVERLAND_POOL_ADDRESS` no seteado | Agent informa error de configuración |
| `Policy denied` en Turnkey | Session key pre-Phase 2 sin políticas Neverland | "Necesitás actualizar tu billetera segura" |
| `UserOp revertido` | USDC insuficiente en Kernel wallet | "No tenés suficiente USDC para guardar ese monto" |

---

## 7. Guardadito — retirar con fee collection (Neverland)

### Pre-condiciones

- Usuario tiene posición activa en Neverland (nUSDC > 0).
- `COMADRE_FEE_WALLET` configurado en el backend.

### Sequence

```mermaid
sequenceDiagram
  participant U as Usuario WhatsApp
  participant TW as Twilio
  participant W as apps/whatsapp :3002
  participant A as apps/agent :3003
  participant K as Moonshot/Kimi K2
  participant API as apps/api :3001
  participant DB as Postgres
  participant NV as Neverland Pool (Monad)
  participant TK as Turnkey HSM
  participant PIM as Pimlico bundler
  participant FW as COMADRE_FEE_WALLET

  U->>TW: "retirá todo mi chanchito"
  TW->>W: POST /webhook
  W->>A: POST /process
  A->>API: tool preparar_retiro_guardadito — GET /api/v1/savings/position
  API->>NV: UiPoolDataProviderV3.getUserReservesData(wallet) → underlyingBalance
  NV-->>API: { nUsdcBalance, underlyingUsdc: 53_000_000 } (ej: 53 USDC)
  API->>DB: SELECT savings_positions WHERE wallet → deposited=50_000_000, principal_withdrawn=0
  API->>API: yieldEarned = 53_000_000 − (50_000_000 − 0) = 3_000_000
  API->>API: fee = 3_000_000 × 20% = 600_000 (0.60 USDC)
  API->>API: userReceives = 53_000_000 − 600_000 = 52_400_000
  API-->>A: { underlyingUsdc: 53, fee: 0.60, userReceives: 52.40 }
  A->>K: chat.completions.create con preview
  K-->>A: "Tenés 53 USDC (ganaste 3 USDC). El fee es $0.60 (20% de lo ganado). ¿Confirmás retirar $52.40?"
  A-->>W: { reply: "Tenés 53 USDC..." }
  W->>TW: send
  TW-->>U: "Tenés 53 USDC..."

  U->>TW: "sí"
  TW->>W: POST /webhook
  W->>A: POST /process
  A->>API: tool confirmar_retiro_guardadito — POST /api/v1/savings/withdraw { amountMicroUsdc: 53_000_000 }
  API->>API: Construye UserOp con 2 calls:<br/>1. NeverlandPool.withdraw(usdc, 53 USDC, kernelWallet)<br/>2. USDC.transfer(feeWallet, 600_000)
  API->>TK: signEvmPayload({ subOrgId, walletId, userOpDigest })
  TK-->>API: firma
  API->>PIM: eth_sendUserOperation
  PIM->>NV: withdraw — burn nUSDC → 53 USDC al Kernel wallet
  PIM->>FW: USDC.transfer(feeWallet, 0.60 USDC)
  PIM-->>API: { txHash }
  API->>DB: UPDATE savings_positions SET principal_withdrawn_micro_usdc += 50_000_000, status=closed
  API-->>A: { status: confirmed, userReceived: 52_400_000, feePaid: 600_000, txHash }
  A->>K: chat.completions.create con tool result
  K-->>A: "Listo! Retiraste $52.40 USDC a tu billetera. Se cobró $0.60 de fee (20% de lo que ganaste)."
  A-->>W: { reply }
  W->>TW: send
  TW-->>U: "Listo! Retiraste $52.40..."
```

### Notas importantes

- El fee es **solo sobre el yield** — en el ejemplo, el usuario depositó $50 y ganó $3, el fee es el 20% de $3 = $0.60. El principal ($50) vuelve íntegro.
- Si no hay yield (underlyingUsdc ≤ deposited), el fee es $0.
- El UserOp es atómico: withdraw + fee transfer se ejecutan en el mismo bloque. No hay estado intermedio.

---

## 8. Guardadito — consultar balance

### Sequence

```mermaid
sequenceDiagram
  participant U as Usuario WhatsApp
  participant TW as Twilio
  participant W as apps/whatsapp :3002
  participant A as apps/agent :3003
  participant K as Moonshot/Kimi K2
  participant API as apps/api :3001
  participant DB as Postgres
  participant NV as Neverland (UiPoolDataProviderV3)

  U->>TW: "¿cuánto tengo en mi chanchito?"
  TW->>W: POST /webhook
  W->>A: POST /process
  A->>K: chat.completions.create
  K-->>A: tool_calls=[{ name: "consultar_guardadito", args: {} }]
  A->>API: GET /api/v1/savings/position
  API->>NV: getUserReservesData(wallet) → underlyingUsdc, apy
  NV-->>API: { underlyingUsdc: 53_000_000, apy: 0.1298 }
  API->>DB: SELECT savings_positions WHERE wallet → deposited=50_000_000, principal_withdrawn=0
  API->>API: yieldEarned = 53_000_000 − 50_000_000 = 3_000_000
  API-->>A: { deposited: 50, currentValue: 53, yieldEarned: 3, apy: 12.98 }
  A->>K: chat.completions.create con tool result
  K-->>A: "Tu chanchito tiene $53 USDC ahora mismo. Empezaste con $50, ya ganaste $3. La tasa de hoy es 12.98% anual."
  A-->>W: { reply }
  W->>TW: send
  TW-->>U: "Tu chanchito tiene $53..."
```

### Guardadito — APR + nudge gate

**APR injection** (`apps/agent/src/lib/savingsContext.ts`): en cada turno del agent donde existe wallet, se inyecta al system prompt:

```
Tasa anual actual del chanchito: X.XX% (variable, no garantizado)
```

`X.XX` viene de `GET /api/v1/savings/summary` → en producción (`YIELD_STRATEGY_PROVIDER=neverland`) es el APY real leído de Neverland via `UiPoolDataProviderV3`. La tasa actual es ~13% (variable, depende del mercado). La regla del system prompt "PORCENTAJE / GANANCIA — REGLA FUNDAMENTAL" obliga al LLM a usar este número exacto cuando el user pregunta cuánto rinde.

**Nudge gate** (`apps/agent/src/lib/nudgeGate.ts`): sugerencias proactivas de Guardadito disparan solo cuando:

- **Trigger**: el user manda un saludo (`hola`, `buenas`) **O** los últimos 6 mensajes contienen un tool result con `tanda_id` + `signature` (post-tanda).
- **Guard**: no hay fila en `savings_nudges` para este user en las últimas 24h.
- Después de entregar la sugerencia, se inserta una fila en `savings_nudges` para arrancar el cooldown de 24h.
