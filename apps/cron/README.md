# @comadre/cron

Long-lived process on Railway that runs scheduled background jobs.
Entrypoint: `src/server.ts` — boots a Hono `/health` endpoint + registers all jobs.

## Jobs

| Job | Schedule | Reads | Stubs |
|---|---|---|---|
| `payoutCrank` | `*/5 * * * *` (every 5 min) | `tandas` WHERE state=active AND next_payout_ts <= now | `payout` tx-build via `makeTxStub` |
| `disputeResolveCrank` | `0 * * * *` (hourly) | `disputes` WHERE state=open AND deadline_ts < now | `resolve_dispute` tx-build via `makeTxStub` |
| `reminderJob` | `0 9 * * *` (daily 09:00 UTC) | `tandas`, `members`, `users`; checks WA window via `@comadre/cache` | WhatsApp `tanda_recordatorio` template via `sendTemplate` |
| `kycRefreshJob` | `0 4 * * *` (daily 04:00 UTC) | `kyc_sessions` WHERE status=pending AND created_at < now-24h | Sumsub status check; marks session `on_hold` |

**Tx-build stubs**: pending `anchor-client` deploy. Replace `makeTxStub` calls with real anchor-client instructions.

**WhatsApp stubs**: pending `apps/whatsapp` merge into main. Replace `sendTemplate` with `POST ${env.WA_URL}/reply`.

## Scheduler features

- In-flight guard: skips a tick if the previous run is still executing
- Timeout: kills jobs exceeding 10 minutes with a structured error log
- Structured Pino logs on start / finish / error per job

## How to run

```bash
# Install (from repo root)
bun install

# Development (hot-reload)
cd apps/cron && bun run dev

# Production
cd apps/cron && bun run start

# Type-check
bun run typecheck

# Tests
bun test
```

Health endpoint: `GET /health` → `{ status: "ok", service: "cron", timestamp }`
