#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "packages/infrastructure"), str(ROOT / "packages/domain")]


def main() -> None:
    base = os.environ.get("BROWSERFLOW_PUBLIC_BASE_URL", "http://127.0.0.1:8000")
    try:
        live = httpx.get(f"{base}/health/live", timeout=3)
        payload = {
            "live_status": live.status_code,
            "live_body": live.json()
            if live.headers.get("content-type", "").startswith("application/json")
            else {},
        }
    except Exception as exc:
        payload = {"live_status": 0, "error": type(exc).__name__}
    print(json.dumps(payload, indent=2))
    print("smoke_test_completed")


if __name__ == "__main__":
    main()
