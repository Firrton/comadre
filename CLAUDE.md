# Comadre — Project Instructions

## Post-task documentation loop (MANDATORY)

After completing any technical change (feature, fix, refactor, security hardening, infrastructure), execute this 3-step loop before reporting the work as done:

### Step 1 — Verify what was done
Review the actual changes (git diff or file reads). Confirm what was added, modified, or removed. Do not rely on memory — verify against the code.

### Step 2 — Inventory tool and component changes
Identify specifically:
- Agent tools added, removed, or modified (check `packages/agent-tools/src/tools.ts` — tool count, registry, executors)
- API endpoints added or changed (check `apps/api/src/routes/`)
- Middlewares added or changed (check `apps/api/src/server.ts`)
- Env vars added or removed
- DB schema changes
- Inter-service communication changes

### Step 3 — Update docs with the inventory
Edit the relevant existing files under `docs/` — do NOT create new doc files.

| File | What to update |
|------|---------------|
| `docs/APPS.md` | Endpoints, middlewares, env vars, flow diagrams, tool counts, inter-service communication |
| `docs/ARCHITECTURE.md` | Topology, auth model, signing flow, security, observability, tool counts |
| `docs/BACKEND.md` | Stack table, completion status, technical decisions |
| `docs/CHECKLIST.md` | Mark completed items `[x]`, update status indicators |
| `docs/RUNBOOK.md` | New error scenarios, env vars, troubleshooting entries |
| `docs/FLOWS.md` | User-facing flows if behavior changed |
| `docs/DATA_MODEL.md` | Schema changes, new tables/columns |

Only update docs relevant to what you actually changed. Keep the existing language (Spanish) and formatting style of each file.
