#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [
    str(ROOT / p)
    for p in [
        "packages/domain",
        "packages/application",
        "packages/infrastructure",
        "packages/flow_schema",
        "packages/flow_compiler",
        "packages/execution_contracts",
        "packages/node_sdk",
        "packages/node_pack_browser",
        "packages/node_pack_control",
        "packages/node_pack_data",
        "packages/node_pack_integration",
        "packages/cli",
        "apps/api",
        "apps/scheduler",
        "apps/browser_worker",
    ]
]


def main() -> None:
    from browserflow.infrastructure.config import get_settings

    settings = get_settings()
    checks = {
        "env": settings.env,
        "bind": settings.bind_host,
        "master_key": Path(settings.master_key_file).is_file(),
        "session_secret": Path(settings.session_secret_file).is_file(),
        "data_dir": Path(settings.data_dir).exists() or True,
    }
    print("BrowserFlow doctor")
    for key, value in checks.items():
        print(f"  {key}: {value}")
    if settings.env == "production" and not checks["master_key"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
