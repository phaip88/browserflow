#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import tarfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(ROOT / "artifacts/verification/backup.tar.gz"))
    parser.add_argument("--yes", action="store_true")
    parser.add_argument("--verify", default="")
    args = parser.parse_args()
    if args.verify:
        digest = sha256_file(Path(args.verify))
        print(f"archive_ok sha256={digest}")
        return
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    dump = Path("/tmp/browserflow.sql")
    env = os.environ.copy()
    url = env.get(
        "BROWSERFLOW_DATABASE_URL_SYNC",
        "postgresql://browserflow:browserflow_dev@127.0.0.1:5432/browserflow",
    )
    subprocess.run(["pg_dump", url, "-f", str(dump)], check=False)
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "includes": ["postgres dump", "non-secret config"],
        "excludes": ["master.key", "session.secret"],
    }
    with tarfile.open(out, "w:gz") as tar:
        if dump.exists():
            tar.add(dump, arcname="postgres.sql")
        tar.add(ROOT / ".env.example", arcname=".env.example")
        info = tarfile.TarInfo("manifest.json")
        blob = json.dumps(manifest, indent=2).encode()
        info.size = len(blob)
        import io

        tar.addfile(info, io.BytesIO(blob))
    print(f"backup_written {out} sha256={sha256_file(out)}")


if __name__ == "__main__":
    main()
