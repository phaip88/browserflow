# BrowserFlow

Single-user, self-hosted, production-grade visual browser automation.

BrowserFlow lets you design flows on a canvas, compile them into an immutable version, and run them with an isolated Playwright Chromium worker. PostgreSQL is the source of truth. Redis is optional.

- English / 中文 UI language switch
- Draft autosave, compile, publish
- Persistent identities, encrypted credentials
- Durable scheduler, leases, and crash recovery

## Quick start (development)

```bash
cp .env.example .env
python3 -m venv .venv
source .venv/bin/activate
make install-dev
make secrets
make migrate
make test-unit
pnpm --filter @browserflow/web test
```

Admin:

```bash
browserflow admin create
browserflow admin reset-password
```

## Production

See `docs/operations/deploy.md`. Use `docker-compose.production.yml`.

## Status

Release 1 is under active construction in `feat/initial-production-platform`.

## 中文

BrowserFlow 是单用户、自托管、工程级的可视化浏览器自动化平台。界面支持中英文切换。
