# HANDOFF

## Restore commands

```bash
cd /home/user
source .venv/bin/activate
export PYTHONPATH=packages/domain:packages/application:packages/infrastructure:packages/flow_schema:packages/flow_compiler:packages/execution_contracts:packages/node_sdk:packages/node_pack_browser:packages/node_pack_control:packages/node_pack_data:packages/node_pack_integration:packages/cli:apps/api:apps/scheduler:apps/browser_worker
sudo pg_ctlcluster 17 main start || true
redis-server --daemonize yes --bind 127.0.0.1 || true
make install-dev
make migrate
```

## Branch

`feat/initial-production-platform`

## Remote

https://github.com/phaip88/browserflow
