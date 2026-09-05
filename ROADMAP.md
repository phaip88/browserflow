# Roadmap

## Release 1 — production core (current)

Administrator init, PostgreSQL + Alembic, Flow/Draft/FlowVersion, compiler, single-threaded engine, durable executions, independent browser worker, leases, Playwright Chromium, identities, credentials, artifacts, network policy, scheduler, outbox + WebSocket replay, visual editor, Docker Compose, backup/restore, tests, observability.

## Release 2 — advanced workflow

- Multi-page orchestration, popup handling
- Upload/download enhancements
- switch / break / continue
- waitForUserInput
- data.map / data.filter
- Webhooks
- Advanced debugging and “run from node”
- S3/MinIO artifact adapter
- More templates
- 500-node editor performance work
- Human Takeover technical spike

## Release 3 — AI and advanced debug

- Real AI providers
- AI Flow Builder / Repair / Diagnostic Explain
- Breakpoints, step over
- Human Takeover
- External BrowserProvider
- External collector templates
- Advanced session live view

Release 1 AI is limited to a provider-neutral interface, Disabled provider, test-only Fake provider, tool schemas, and compiler safety. Fake must not be configured in production.
