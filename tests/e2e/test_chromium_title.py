from __future__ import annotations

import pytest

pytestmark = pytest.mark.e2e


@pytest.mark.asyncio
async def test_chromium_reads_title() -> None:
    from playwright.async_api import async_playwright

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        await page.set_content("<html><head><title>BrowserFlow</title></head><body>ok</body></html>")
        assert await page.title() == "BrowserFlow"
        await browser.close()
