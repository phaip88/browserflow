# Deploy

## Development

```bash
cp .env.example .env
make secrets
make install-dev
make migrate
uvicorn browserflow.api.main:app --host 127.0.0.1 --port 8000
python -m browserflow.scheduler
python -m browserflow.browser_worker
pnpm --filter @browserflow/web dev
browserflow admin create
```

## Production Compose

1. Create `secrets/master.key`, `secrets/session.secret`, `secrets/postgres_password`.
2. `docker compose -f docker-compose.production.yml up -d --build`
3. Run migrations inside the API container.
4. `browserflow admin create`

Do not publish PostgreSQL or Redis ports. Do not mount the Docker socket. Restrict egress with a firewall or forward proxy in addition to application NetworkPolicy.

## Backup

`make backup-test` exercises `scripts/backup.py`. Master keys are never stored in the archive.
