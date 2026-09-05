# ADR 0001 — Modular monolith + independent worker

PostgreSQL is the only source of truth. The API, scheduler, and worker are separate processes so a Chromium crash cannot take down the control plane. Redis is optional.
