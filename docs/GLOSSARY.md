# Comadre — Glosario técnico

> Términos del dominio (financiero + Solana + arquitectura) que aparecen seguido en el código y los docs. Si encontrás un acrónimo y no sabés qué significa, este es el lugar.

## Dominio financiero — tandas

**Tanda** — Grupo rotativo de ahorro. 3-20 personas aportan un monto fijo cada N días; en cada turno una persona se lleva el pot completo. También conocida como *cundina* (México), *susu* (África Occidental), *pasanaku* (Bolivia), *ROSCA* (rotating savings and credit association). En Comadre cada tanda es un PDA + un vault USDC en Solana.

**Stake-to-join** — Garantía que un miembro deposita al unirse. Si default-ea (no contribuye en su turno), el stake se queda. En Comadre el stake = 1× el aporte por turno (decisión cerrada).

**Payout** — Distribución del pot del turno actual al miembro cuyo `turn_number` coincide con `tanda.current_turn`. Lo dispara `apps/cron payoutCrank` cada 5 min, o cualquiera puede invocar `payout` instruction post-deadline.

**PayoutOrder** — Estrategia de turnos: `JoinOrder` (1ro en sumarse, 1ro en cobrar — único activo en MVP), `CreatorSet` (creador asigna), `Random` (VRF — no implementado, hard-rejected en `start_tanda`).

**Slash** — Penalidad on-chain por default. Ver `slash_defaulter` instruction. La parte stakeada del miembro inactivo se transfiere al `fee_destination` después de 24h grace post-payout deadline (`SLASH_GRACE_SECONDS`).

**Dispute** — Mecanismo de gobernanza: cualquier miembro abre disputa, tanda pasa a `Paused`, miembros votan continue/cancel en ventana de 7 días (`DISPUTE_VOTING_WINDOW_SECONDS`). Mayoría continue → vuelve a `Active`; tie o cancel → `Cancelled`.

**KYC tier** — Nivel de verificación de identidad. 4 niveles ordinales: `T0Demo`, `T1Lite`, `T2Standard`, `T3Pro`. Determina el límite por transferencia (`kyc_limits[tier]` en `ProgramConfig`). MVP usa fallback hardcoded `[10, 100, 1000, 10000]` USD si `init_config` no corrió.

**Reputation score** — `u32` denormalizado en `UserProfile`. Sube por completar tandas, baja por defaults. SBT-like — no transferable.

## Dominio financiero — transferencias P2P

**P2P (phone-to-phone)** — Transferencia USDC entre dos números de WhatsApp. NO usa el program Anchor de Comadre — es un SPL Token Transfer estándar. La tabla `transfers` es un ledger off-chain operacional.

**Immediate transfer** — Recipient está registrado (DB primary o Privy fallback). API arma tx + Redis stash 5min, sender confirma → Privy server-sign → broadcast. Ver `docs/FLOWS.md#1`.

**Deferred transfer** — Recipient NO registrado. `mode=deferred`, no on-chain action; Comadre WhatsApp's al recipient con "aceptar". Ventana 7 días. **Earmark off-chain solamente** — el balance USDC del sender sigue siendo gastable; trade-off documentado.

**Earmark** — Marca contable off-chain. NO es un lock real on-chain. Si el sender gasta esos USDC en otra cosa antes del confirm, la transfer falla con `failure_reason="insufficient balance at confirm time"`.

## Solana

**PDA (Program-Derived Address)** — Account address derivada determinísticamente de seeds + programId, sin private key. Solo el program puede firmar como esta address vía `invoke_signed`. En Comadre cada `Tanda`, `Member`, `Dispute`, etc. es un PDA. Ver `packages/anchor-client/src/pdas.ts` para los 10 derivers.

**ATA (Associated Token Account)** — Account de un SPL token "asociado" deterministicamente a una wallet+mint. Cada usuario tiene 1 ATA por mint que tiene. `getAssociatedTokenAddressSync(mint, owner)` lo deriva. Si no existe, hay que crearlo con `createAssociatedTokenAccountInstruction(payer, ata, owner, mint)` — `payer` paga el rent (~0.002 SOL).

**SPL Token** — El token program estándar de Solana. USDC es un SPL token (mint en devnet: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`).

**Lamport** — Unidad mínima de SOL. 1 SOL = 10⁹ lamports.

**Micro-USDC (atomic units)** — Unidad mínima de USDC. USDC tiene 6 decimales: 1 USDC = 1,000,000 micro-USDC. Toda la persistencia y on-chain usa bigint en micro-USDC para evitar IEEE 754. Ver `usdcToMicro` / `microToUsdc` en `apps/api/src/lib/usdcTransfer.ts`.

**Rent (rent-exempt)** — Solana cobra "alquiler" por el storage de un account. Si depositás suficiente SOL para cubrir 2 años de rent, el account es **rent-exempt** (no se borra). Programas y PDAs de cuentas SIEMPRE son rent-exempt (~3.48 SOL para el binary del program Comadre).

**Priority fee** — Microlamports/CU adicional para dar prioridad a una tx. Helius RPC expone `getPriorityFeeEstimate`. Ver `packages/solana/src/priorityFee.ts` (fallback 1000).

**CU (compute unit)** — Unidad de "trabajo" computacional en Solana. Una tx tiene un budget de CUs (default 200k). Se setea explícito con `ComputeBudgetProgram.setComputeUnitLimit`.

**Blockhash** — Hash del último block. Una tx incluye `recent_blockhash` para anti-replay; expira ~90s después. `submitWithRetry` en `packages/solana/src/retry.ts` detecta `BlockhashNotFound` y exige al caller rebuildear.

**CAIP-2** — Format estándar para identificar chain+network. Solana mainnet: `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp...`; devnet: `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1...`. Privy lo usa internamente.

**Anchor IDL** — Interface Description Language: JSON con la metadata del program (instructions, accounts, types, errors, events). Se genera con `anchor build`, se sube on-chain con `anchor idl init`, se consume desde TS con `@coral-xyz/anchor` para construir `Program<Comadre>`.

**Discriminator** — Primeros 8 bytes de cada account on-chain; identifican el tipo (UserProfile, Tanda, etc.). Anchor lo computa del nombre + namespace.

## Wallets backend de Comadre

| Wallet | Rol |
|---|---|
| `fee_payer` | Sponsorea rent + tx fees de los users |
| `crank_authority` | Firma instructions sin riesgo financiero (`payout`, `complete_tanda`, `slash_defaulter`, `resolve_dispute`) |
| `kyc_oracle` | Firma `update_kyc_tier` post Sumsub webhook |
| `admin` | `init_config`, `pause`/`unpause`. Multisig Squads en mainnet |

## Auth + idempotency

**Privy JWT** — Token de sesión emitido por Privy server-auth tras phone OTP. `apps/api authMiddleware` verifica con `privy.verifyAuthToken(token)`. Linked accounts contiene el embedded Solana wallet `walletId`.

**Privy embedded wallet** — Wallet creada y custodiada por Privy. Comadre la consume server-side via `privy.walletApi.solana.signTransaction({walletId, transaction})` para firmar txs en nombre del user. Custodial-feel pero authentic — el user se autenticó con Privy via phone OTP.

**Privy `walletId` vs `userId`** — `userId` es el DID de Privy (`did:privy:...`). `walletId` es un ID interno por wallet en `linkedAccounts[].id`. Para `signTransaction` se usa `walletId`.

**HMAC interno** — Service-to-service auth via `crypto.createHmac("sha256", env.INTERNAL_HMAC_SECRET).update(body).digest("hex")` enviado en `X-Internal-Auth` (whatsapp /reply) o `X-Internal-Signature` (api desde agent-tools). Min 32 chars el secret.

**Idempotency key** — UUID enviado en `X-Idempotency-Key` por el cliente en POST. `withIdempotency` en `@comadre/cache` cachea response 24h con key `idempotency:{key}`. Resultado: replays devuelven la misma response sin re-ejecutar el handler. Ver `apps/api/src/middlewares/idempotency.ts`.

**Dev-mode bypass** — En `NODE_ENV !== "production"`, `apps/api/auth.ts` acepta `X-Dev-Wallet` + `X-Dev-User-Id` headers en lugar de Privy JWT. Solo para tests locales. **Nunca en prod.**

## Cache + state

**WhatsApp 24h window** — Política de Meta/Twilio: outbound free-form solo permitido dentro de 24h del último inbound del user. Después solo templates pre-aprobados. Ver `packages/cache/src/waWindow.ts` (`recordInbound` + `isWithinWindow`).

**Phone hash** — SHA-256 hex del E.164 (con `+`). Determinístico, sin salt, sirve para indexar `users` por phone sin guardar PII en logs. Función: `hashPhone` en `packages/cache/src/waWindow.ts`.

**E.164** — Formato internacional para phones: `+<country><nsn>`, 7-15 dígitos después del `+`. Ej: `+5218116346072`. WhatsApp hace quirks (México prefija "1" después de "+52", Argentina "9" después de "+54") — ver `apps/api/src/lib/phoneNormalize.ts`.

## LLM agent

**Tool-use loop** — Patrón conversacional con LLM. Cada iter: send messages + tools al modelo → si responde con `tool_calls`, ejecutar cada uno + append `role:tool` message → loop. Ver `apps/agent/src/agentLoop.ts` (`MAX_TOOL_ITERATIONS=5`).

**System prompt** — Instrucción inicial al LLM ("Sos Comadre, tía cariñosa..."). Define personalidad, idioma (LATAM neutral), reglas de transferencia (siempre confirmar), onboarding flow. Ver `apps/agent/src/lib/systemPrompt.ts`.

**Conversation key** — Identificador del thread WA (typically el `From` header `whatsapp:+E164`). Index en Redis `agent:conv:{key}` con TTL 24h.

**Moonshot Kimi** — Provider del LLM. Modelo `kimi-k2-0905-preview` (vía Moonshot directo) o `moonshotai/kimi-k2-instruct` (vía Groq). Cliente OpenAI-compatible (mismo SDK).

## Operacional

**`init_config`** — Bootstrap singleton del program. Se llama UNA vez post-deploy con args `kyc_oracle, crank_authority, fee_destination, fee_bps, kyc_limits`. Sin esto el `ProgramConfig` PDA no existe y `apps/api kycLimits.ts` cae a hardcoded fallback.

**`INITIAL_DEPLOYER`** — Constant en `packages/anchor-program/src/constants.rs` para gating de `init_config` (solo el deployer puede llamar). Hoy es `Pubkey::default()` placeholder; **antes de mainnet hay que reemplazarlo** y quitar `localnet` del default features de `Cargo.toml`.

**Crank** — Patrón Solana: cualquier user puede invocar instructions que sean "permissionless triggers" (`payout`, `complete_tanda`, `resolve_dispute`). Comadre tiene un crank híbrido: `apps/cron` corre un crank backend + cualquier observador puede invocar (resilencia).

**Indexer** — Servicio que escucha events Anchor (Helius webhook) y materializa el state on-chain a Postgres. **MVP: esqueleto solamente** (`apps/indexer/src/index.ts`). Para P2P transfers no aplica (son SPL Token Transfer, no events Anchor); para tandas/disputes sí va a hacer falta.

**Cloudflared tunnel / ngrok** — Herramientas para exponer `apps/whatsapp:3002` localmente al webhook de Twilio. URL pública cambia en cada restart de cloudflared.
