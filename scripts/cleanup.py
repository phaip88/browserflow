#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--days", type=int, default=14)
    args = parser.parse_args()
    root = Path("data/artifacts")
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.days)
    removed = 0
    if root.exists():
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
            if mtime < cutoff:
                print(f"expire {path}")
                removed += 1
                if not args.dry_run:
                    path.unlink()
    print(f"cleanup_done dry_run={args.dry_run} removed={removed}")


if __name__ == "__main__":
    main()
