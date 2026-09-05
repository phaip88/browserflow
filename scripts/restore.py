#!/usr/bin/env python3
from __future__ import annotations

import argparse
import tarfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description="Restore a BrowserFlow backup archive")
    parser.add_argument("--archive", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--yes", action="store_true")
    args = parser.parse_args()
    archive = Path(args.archive)
    if not archive.is_file():
        raise SystemExit("archive not found")
    with tarfile.open(archive, "r:gz") as tar:
        names = tar.getnames()
        print("archive_members", names)
        if args.dry_run:
            print("dry_run_ok")
            return
        if not args.yes:
            raise SystemExit("refusing to overwrite without --yes")
        tar.extractall("/tmp/browserflow-restore")
        print("restore_extracted")


if __name__ == "__main__":
    main()
