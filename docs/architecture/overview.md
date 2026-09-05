# Architecture

BrowserFlow is a modular monolith control plane plus an independent Browser Worker.

Processes:

- `web` — React UI
- `api` — FastAPI control plane
- `scheduler` — durable cron/once dispatcher
- `browser-worker` — Playwright Chromium executor
- `postgres` — source of truth
- `redis` — optional wake-up / fan-out

Rules:

- API never executes browser flows.
- Worker never shares a process with the API.
- Redis outage does not drop tasks; workers poll PostgreSQL.
- WebSocket is not the owner of execution lifecycle.
- Default browser concurrency is 1 (max 2).
