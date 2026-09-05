# HANDOFF

## Run locally

```bash
cd /home/user
source .venv/bin/activate
export PYTHONPATH=packages/domain:packages/application:packages/infrastructure:packages/flow_schema:packages/flow_compiler:packages/execution_contracts:packages/node_sdk:packages/node_pack_browser:packages/node_pack_control:packages/node_pack_data:packages/node_pack_integration:packages/cli:apps/api:apps/scheduler:apps/browser_worker
export BROWSERFLOW_MASTER_KEY_FILE=/home/user/secrets/master.key
export BROWSERFLOW_SESSION_SECRET_FILE=/home/user/secrets/session.secret
sudo pg_ctlcluster 17 main start || true
redis-server --daemonize yes --bind 127.0.0.1 || true
.venv/bin/alembic upgrade head
.venv/bin/uvicorn browserflow.api.main:app --host 127.0.0.1 --port 8000
# other terminals:
python -m browserflow.scheduler
python -m browserflow.browser_worker
pnpm --filter @browserflow/web dev
browserflow admin create
```

## Tests

```bash
.venv/bin/pytest tests -q
pnpm --filter @browserflow/web test
```

## Branch

`feat/initial-production-platform`
