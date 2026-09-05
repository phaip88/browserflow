# DECISIONS

## D1 — Python runtime
Python 3.12 images; local sandbox 3.13.

## D2 — Package layout
Namespace package `browserflow` via explicit setuptools package-dir.

## D3 — Database
PostgreSQL only. Local/dev uses 17, Compose pins 16.6.

## D4 — Redis optional
Workers and scheduler poll PostgreSQL.

## D5 — IDs and time
UUID PKs. `datetime.now(timezone.utc)`.

## D6 — Auth
Authenticated default. Argon2id, HttpOnly session, CSRF cookie.

## D7 — Browser
Playwright Chromium only. Concurrency 1–2.

## D8 — i18n
en / zh switcher persisted in localStorage.

## D9 — AI Release 1
disabled in production; fake is test-only.

## D10 — Optimistic locking
Integer `version` columns; worker updates also match lease_token + attempt_id.
