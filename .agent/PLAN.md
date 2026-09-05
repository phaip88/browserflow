# BrowserFlow Implementation Plan

## Status

Release 1 production platform, built from an empty directory.

## Stages

1. Project initialization, toolchain, CI, health tests. **IN PROGRESS**
2. Domain model, PostgreSQL, Alembic, repositories, state machine, concurrency.
3. Config, master key, auth, session, CSRF, rate limit, audit.
4. Flow schema, node/edge schema, compiler, diagnostics, deterministic plan.
5. Execution API, DB queue, lease, heartbeat, stale-worker guard, retry, cancel, recovery.
6. BrowserProvider, Chromium, BrowserSession, Identity, profile lock, NetworkPolicy, cleanup.
7. Node SDK, registry, contract tests, all Release 1 nodes.
8. Credential, SecretResolver, Artifact, SafePath, Event, Outbox, Publisher, WebSocket replay.
9. Scheduler: cron, timezone, misfire, overlap, dedup, recovery.
10. Frontend Release 1 pages, editor, diagnostics, execution replay, tests, i18n (en/zh).
11. AI interface, Disabled provider, test-only Fake provider, unconfigured UI.
12. Docker, Compose, health, metrics, tracing, backup, restore, doctor, cleanup, docs.
13. Format, lint, type, unit, contract, integration, e2e, security, stability, gates.

## Rules

- PostgreSQL is the source of truth.
- Redis is optional.
- API never executes browser flows.
- Browser Worker is a separate process.
- No confirmation between stages.
- Atomic commits per stage.
