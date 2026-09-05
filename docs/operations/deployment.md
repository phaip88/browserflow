# Deployment & operations
## Compose (production)
`docker-compose.production.yml`: non-root images, tini for SIGTERM, read-only root FS, tmpfs, CPU/memory/PID limits, `/dev/shm` for Chromium, no Docker socket, PostgreSQL not exposed. The `migrate` job runs the schema push before API/scheduler/worker start.
## Network egress
The application NetworkPolicy blocks private/loopback/metadata addresses, but you must also restrict egress at the host: e.g. `iptables -A DOCKER-USER -s <worker-subnet> -d 10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,169.254.0.0/16 -j DROP`, or route the `egress` network through a filtering proxy.
## Upgrade (expand & contract)
1. `browserflow backup <dir>` 2. verify manifest 3. apply backward-compatible migration 4. deploy api + scheduler 5. `docker compose stop browser-worker` (SIGTERM drains up to `BROWSERFLOW_GRACEFUL_SHUTDOWN_MS`) 6. deploy new worker 7. `browserflow doctor` + `browserflow smoke` 8. verify credential decryption 9. contract (drop old columns) in a later release.
## Backup / restore
`backup` writes `database.sql` (pg_dump), artifacts, identity profiles, non-secret config, and `manifest.json` with SHA-256 for every file. The master key is **not** included — store it separately. `restore --dry-run` verifies checksums; `restore --yes` overwrites, then reports users/flows/versions/schedules/identities/executions/credential decryption/schema table count.
## Health & metrics
`/api/health/live`, `/api/health/ready` (DB + cached worker browser self-check, never launches a browser), `/api/metrics` (Prometheus). Logs are JSON lines with redaction.
## Cleanup
`browserflow cleanup [--dry-run] [--batch N]` and hourly in the scheduler: expired executions (cascade), published outbox rows, sessions, audit, dead workers, old events; artifact files removed with their executions.
