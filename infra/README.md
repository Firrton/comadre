# infra/

Railway config-as-code files for the Comadre monorepo.

## Service → config file mapping

| Railway service | Config file |
|----------------|-------------|
| api | `infra/railway.api.toml` |
| agent | `infra/railway.agent.toml` |
| whatsapp | `infra/railway.whatsapp.toml` |
| cron | `infra/railway.cron.toml` |

## Required dashboard step (owner action, per service)

Railway does **not** auto-detect config files outside the repo root. Each service must be pointed at its file manually:

1. Open the Railway dashboard → select the project → select the service.
2. Go to **Settings** → find the **Config File Path** field.
3. Set it to the absolute path, e.g. `/infra/railway.api.toml`.
4. Repeat for every service.

Without this step the files are ignored and Railway falls back to dashboard settings.

## Environment variables

All env vars (DATABASE_URL, API keys, etc.) are managed in Railway's service **Variables** panel, not in these files. Never commit secrets here.

## cron replica constraint

The `cron` service MUST run at exactly **1 replica**. `node-cron` has no distributed lock — multiple replicas would fire every scheduled job N times simultaneously. Set this in Railway: service → **Settings** → **Replicas** → `1`.

## Build context

All services build from the **repo root** (not the app subdirectory). Workspace packages (`@comadre/*`) are consumed as TypeScript source, so the full checkout + workspace install is required at build time. Do NOT set a per-service Root Directory in Railway — it would break workspace resolution.
