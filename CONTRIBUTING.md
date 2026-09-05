# Contributing

1. Use `feat/initial-production-platform` until Release 1 ships.
2. `make format-check lint typecheck test-unit` before a PR.
3. Do not add Release 2/3 UI façades.
4. Do not log secrets, cookies, or session identifiers.
5. All schema changes go through Alembic.
