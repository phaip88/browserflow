# DECISIONS

## D1 — Python runtime

Use Python 3.12 in production images (`python:3.12-slim-bookworm`). Local sandbox provides 3.13; code targets 3.12+ and is verified on 3.13.

## D2 — Package layout

Namespace package `browserflow` assembled from `packages/*` and `apps/{api,scheduler,browser_worker}` via setuptools `packages.find` with `namespaces = true`.

## D3 — Database

PostgreSQL 16+ only. Local/dev currently uses PostgreSQL 17. No SQLite adapter.

## D4 — Redis

Optional accelerator for wake-up and WebSocket fan-out. Workers and scheduler poll PostgreSQL when Redis is down.

## D5 — IDs and time

UUID primary keys. All timestamps `datetime.now(timezone.utc)` stored as `timestamptz`.

## D6 — Auth

Authenticated by default. Local-only unauthenticated mode requires bind `127.0.0.1` AND explicit config flag. Argon2id passwords, HttpOnly session cookie, CSRF token.

## D7 — Browser

Single provider: Playwright Chromium. Default concurrency 1, configurable to 2.

## D8 — i18n

UI supports English and Simplified Chinese with a persistent language switcher.

## D9 — AI Release 1

`disabled` in production. `fake` allowed only when `BROWSERFLOW_ENV=test`. Configuring fake in production fails startup.
