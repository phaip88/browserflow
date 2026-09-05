from __future__ import annotations

import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path("/srv/dist")
INDEX = ROOT / "index.html"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = Path(self.translate_path(self.path))
        if not path.exists() or path.is_dir():
            self.path = "/index.html"
        return super().do_GET()


def main() -> None:
    host = os.environ.get("BROWSERFLOW_WEB_BIND", "0.0.0.0")
    port = int(os.environ.get("BROWSERFLOW_WEB_PORT", "8080"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
