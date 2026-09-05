# BrowserFlow

Single-user, self-hosted, production-grade visual browser automation platform.

**Architecture:** modular control plane (Next.js App Router: web UI + REST/SSE API) + independent **scheduler** process + independent **browser-worker** process (Playwright Chromium). PostgreSQL is the single source of truth for every persistent state (flows, versions, executions, attempts, leases, events, outbox, schedules, credentials, identities, artifacts, workers, audit). No in-memory queue; Redis is optional and unused by the core path.

```
web/api (Next.js)  ──►  PostgreSQL  ◄──  scheduler (cron, misfire/overlap, outbox publisher, lease reaper, cleanup)
   ▲  SSE replay             ▲
   └── browser (React Flow)  └──  browser-worker (FOR UPDATE SKIP LOCKED lease → engine → Chromium)
```

## Quick start (single host)

```bash
cp .env.example .env                      # set DATABASE_URL
mkdir -p secrets && openssl rand -base64 32 > secrets/master.key && chmod 600 secrets/master.key
npm ci && npx playwright install --with-deps chromium
npx drizzle-kit push --force              # apply schema
npm run build && npm start                # API + web on :3000; embedded supervisor spawns scheduler + worker as separate processes
# or run them explicitly (Docker Compose does this):
BROWSERFLOW_EMBEDDED_SUPERVISOR=false npm start & npm run scheduler & npm run worker
```

Open http://127.0.0.1:3000 → create the administrator (12+ char password) → **Templates** → create a draft → **Publish** → **Run ▶**.
Templates target the bundled local E2E site (`/e2e-site/*`). Because private networks are blocked by default, add `BROWSERFLOW_NETWORK_PRIVATE_ALLOWLIST=127.0.0.1` to `.env` to run them locally (warns at startup; remove it in production).

CLI: `npm run cli -- admin create <email> <password>` · `admin reset-password` · `doctor` · `cleanup [--dry-run]` · `backup <dir>` · `restore <dir> [--dry-run|--yes]` · `smoke [--template id]`.

## Production (Docker Compose)
```bash
export POSTGRES_PASSWORD=...; docker compose -f docker-compose.production.yml up -d --build
```
See `docs/operations/deployment.md` for network egress controls, upgrades (expand & contract), backup/restore and limits.

## Verification
`make verify` runs typecheck, lint, unit/contract/security tests, build, compose validation, Chromium smoke test, backup/restore checks and the stability suite. Evidence is written to `artifacts/verification/` (see `docs/operations/verification.md` and `.agent/TEST_RESULTS.md`).

## Repository layout
`src/core` config/logging/security/network-policy · `src/flow` schema & compiler · `src/nodes` catalog/SDK/implementations · `src/execution` state machine, events/outbox, lease service, engine · `src/runtime` BrowserSession, artifacts, credentials, identities · `src/auth` · `src/server` HTTP router + routes · `src/app` UI · `worker/`, `scheduler/`, `scripts/` processes & CLI · `tests/` · `infrastructure/` · `docs/`.
