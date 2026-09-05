# BLOCKERS

## GitHub push

`git push https://github.com/phaip88/browserflow.git feat/initial-production-platform` failed:

```
fatal: could not read Username for 'https://github.com': terminal prompts disabled
```

No `GH_TOKEN`, SSH key, or git credential helper is present in this sandbox. Local commits:

- `673f630` feat: initialize BrowserFlow toolchain, health API, and i18n web shell
- `be082f4` feat: add domain, compiler, engine, worker, scheduler, and i18n UI

To publish from a machine with access:

```bash
git remote add origin https://github.com/phaip88/browserflow.git
git push -u origin feat/initial-production-platform
```

## Playwright install-deps

`playwright install-deps` failed on missing Debian font packages (`ttf-unifont`). Chromium still launches after installing the core GTK/NSS libraries (`133.0.6943.16`).

## Full Compose image build

Not executed in this environment (time/disk). Compose files validate.
