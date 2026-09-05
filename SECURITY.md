# Security

- **Authentication**: Argon2id password hashes, HttpOnly/SameSite=Strict (Secure in production) session cookie, per-session CSRF token required on mutating requests, origin check, login rate limiting (audit-log backed), session revocation on password change, CLI password reset. `local-only` mode is refused unless bound to 127.0.0.1.
- **Secrets**: credentials encrypted with AES-256-GCM under a master key loaded from `BROWSERFLOW_MASTER_KEY_FILE` (never in DB/repo/logs). Flows store only `credential:<name>#<field>` references; values are resolved immediately before node execution, registered with the redaction filter, and never written to events, node outputs, artifacts, exports or logs.
- **SSRF / network policy**: HTTP node resolves all DNS records and checks every redirect hop; the browser context intercepts every request (documents, subresources, iframes, popups, websockets) and blocks loopback, RFC1918, CGNAT, link-local, cloud metadata, IPv6 local and internal service names. Application policy is not the only line of defence: run the worker in an egress-restricted network (see deployment docs).
- **Files**: all artifact paths pass through `resolveSafePath` (no traversal, absolute, drive/UNC, symlink escape, illegal names, overwrite); quotas per artifact, per execution and globally; disk-space checks.
- **Isolation**: the API never runs browsers; the worker leases work from PostgreSQL and every write is guarded by execution/attempt/worker/lease-token; stale workers cannot overwrite newer state.
- Report vulnerabilities privately to the repository owner.
