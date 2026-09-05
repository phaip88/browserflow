# Node authoring

Release 1 nodes live in `packages/node_pack_*`. Each handler exposes a `NodeSpec` and an async `run(ctx)` method.

Nodes must not:

- touch the database
- send WebSockets
- resolve secrets except through SecretResolver
- build filesystem paths except via ArtifactService
- swallow exceptions and return success
