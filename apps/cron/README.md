# @comadre/cron

Jobs programados. Firma con `crank_authority` wallet (sin riesgo financiero).

**Jobs:**
- `payoutCrank` — `*/5 * * * *` — ejecuta `payout` cuando llega `next_payout_ts`.
- `disputeResolveCrank` — `0 * * * *` — resuelve disputas con deadline pasado.
- `reminderJob` — `0 9 * * *` — manda recordatorios de aporte vía WhatsApp + push.
- `kycRefreshJob` — `0 4 * * *` — re-valida tiers expirados con Sumsub.
