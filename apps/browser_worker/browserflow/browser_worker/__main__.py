from __future__ import annotations

import asyncio
import signal

from browserflow.browser_worker.service import BrowserWorker
from browserflow.infrastructure.config import get_settings, require_production_secrets
from browserflow.infrastructure.logging import configure_logging, get_logger

logger = get_logger(__name__)


async def run() -> None:
    settings = get_settings()
    configure_logging(settings)
    require_production_secrets(settings)
    worker = BrowserWorker(settings)
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, worker.request_stop)
    logger.info("worker_starting", service="browser-worker")
    await worker.run_forever()


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
