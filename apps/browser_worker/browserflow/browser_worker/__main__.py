from __future__ import annotations

import asyncio

from browserflow.infrastructure.config import get_settings, require_production_secrets
from browserflow.infrastructure.logging import configure_logging, get_logger

logger = get_logger(__name__)


async def run() -> None:
    settings = get_settings()
    configure_logging(settings)
    require_production_secrets(settings)
    logger.info("worker_starting", service="browser-worker")
    while True:
        await asyncio.sleep(settings.worker_poll_interval_seconds)


def main() -> None:
    asyncio.run(run())


if __name__ == "__main__":
    main()
