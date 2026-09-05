# Contributing
- Branch from `main`, keep commits atomic. Run `make typecheck lint test test-contracts` before pushing.
- Schema changes go through `src/db/schema.ts` + `drizzle-kit` (generate migrations for production; never mutate schema at app start).
- New nodes: add metadata to `src/nodes/catalog.ts` and an implementation in `src/nodes/impl.ts`; contract tests enforce parity. Nodes must not touch the DB, WebSockets, raw paths, or unmanaged browsers (see docs/node_authoring).
