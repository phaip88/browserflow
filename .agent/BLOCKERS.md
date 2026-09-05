# BLOCKERS

None yet.

Notes:

- Sandbox policy-rc.d blocks systemd service start; PostgreSQL and Redis are started via `pg_ctlcluster` and `redis-server --daemonize`.
- Local Python is 3.13 rather than 3.12; production images pin 3.12.
