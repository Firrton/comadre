# @comadre/solana

Helpers de Solana. Tx building, fee payer management, retry logic.

Wallets controladas:
- `fee_payer` — paga rents + fees
- `crank_authority` — llama instructions sin riesgo (payout, complete)
- `kyc_oracle` — firma update_kyc_tier
- `admin` — pause, init_config (multisig en mainnet)
