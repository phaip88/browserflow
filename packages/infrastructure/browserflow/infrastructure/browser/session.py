from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import UUID

from browserflow.domain.errors import BrowserFlowError, ErrorCode
from browserflow.infrastructure.config import Settings, get_settings
from browserflow.infrastructure.logging import get_logger
from browserflow.infrastructure.network_policy import BrowserRequestNetworkPolicy

logger = get_logger(__name__)


class BrowserSession:
    def __init__(
        self,
        *,
        execution_id: UUID,
        identity_dir: Path | None = None,
        settings: Settings | None = None,
    ) -> None:
        self.execution_id = execution_id
        self.identity_dir = identity_dir
        self.settings = settings or get_settings()
        self._playwright: Any = None
        self._browser: Any = None
        self._context: Any = None
        self.pages: dict[str, Any] = {}
        self._policy = BrowserRequestNetworkPolicy()
        self.playwright_version: str | None = None
        self.chromium_version: str | None = None

    async def start(self) -> None:
        from playwright.async_api import async_playwright

        self._playwright = await async_playwright().start()
        self.playwright_version = getattr(self._playwright, "version", None) or "1.50.0"
        runtime = Path(self.settings.runtime_dir) / "executions" / str(self.execution_id)
        runtime.mkdir(parents=True, exist_ok=True)
        user_data = None
        if self.identity_dir is not None:
            user_data = str(self.identity_dir / "profile")
            Path(user_data).mkdir(parents=True, exist_ok=True)
        launch_args = ["--disable-dev-shm-usage", "--no-sandbox"]
        if user_data:
            self._context = await self._playwright.chromium.launch_persistent_context(
                user_data,
                headless=True,
                args=launch_args,
                downloads_path=str(runtime / "downloads"),
            )
        else:
            self._browser = await self._playwright.chromium.launch(headless=True, args=launch_args)
            self._context = await self._browser.new_context(accept_downloads=True)
        self.chromium_version = (
            self._context.browser.version if self._context.browser else "chromium"
        )
        await self._context.route("**/*", self._on_route)
        page = self._context.pages[0] if self._context.pages else await self._context.new_page()
        self.pages["default"] = page

    async def _on_route(self, route: Any) -> None:
        url = route.request.url
        if not self._policy.allow_request(url):
            await route.abort("blockedbyclient")
            return
        await route.continue_()

    def page(self, name: str = "default") -> Any:
        page = self.pages.get(name)
        if page is None:
            raise BrowserFlowError(ErrorCode.BROWSER, f"page {name} not found")
        return page

    async def screenshot(self, path: Path) -> None:
        page = self.page()
        await page.screenshot(path=str(path), full_page=False)

    async def close(self) -> None:
        try:
            if self._context is not None:
                await self._context.close()
        except Exception:
            logger.warning("browser_context_close_failed")
        try:
            if self._browser is not None:
                await self._browser.close()
        except Exception:
            logger.warning("browser_close_failed")
        try:
            if self._playwright is not None:
                await self._playwright.stop()
        except Exception:
            logger.warning("playwright_stop_failed")
        self._context = None
        self._browser = None
        self._playwright = None
        self.pages.clear()
