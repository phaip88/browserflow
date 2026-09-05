# Test results (generated 2026-09-04T21:48:17.059Z)
| Suite | Command | Result |
|---|---|---|
| Unit (compiler, security, state machine, scopes) | `npx vitest run tests/unit` | 22 passed |
| Node contract tests (42 nodes) | `npx vitest run tests/contracts` | 44 passed |
| Security (SSRF, safe path, crypto, redaction) | `npx vitest run tests/unit/security.test.ts` | 12 passed |
| E2E real Chromium, 8 templates vs local site | `scripts/e2e.sh` | 8 passed / 0 failed in 14s |
| Stability | `scripts/stability.ts` | 110/110 executions ok in 12343ms; cancel=True workerLost/anti-stale=True timeout=True events gap-free=True chromium residue=0 |
| Smoke (template→publish→run) | `browserflow smoke` | see artifacts/verification/smoke-test.txt |
| Backup / restore dry-run | `browserflow backup/restore` | see backup-test.txt / restore-test.txt |
| Live API E2E (setup, login, CSRF, credential login flow) | curl session (this run) | SUCCEEDED, output "Welcome, demo", 0 secret leaks in events |
| Typecheck / lint / build | `tsc --noEmit`, `eslint --max-warnings=0`, `next build` | pass |

Gaps: coverage.xml (no coverage tool installed in sandbox), sbom.cdx.json and docker image build (no Docker in sandbox; CI workflow covers), integration test summary folded into stability/e2e evidence, frontend-junit (no component tests written; editor verified manually via build + live API), Redis chaos, Postgres outage chaos, WebSocket long-disconnect (SSE reconnect implemented, not chaos-tested), 10 long tasks.
