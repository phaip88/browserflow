from __future__ import annotations

from typing import Any

from browserflow.domain.enums import SideEffectLevel
from browserflow.node_sdk.context import ExecutionContext
from browserflow.node_sdk.result import NodeResult
from browserflow.node_sdk.spec import NodeSpec


def _spec(
    type_: str, name: str, desc: str, level: SideEffectLevel = SideEffectLevel.WRITE
) -> NodeSpec:
    return NodeSpec(
        type=type_,
        version="1",
        category="browser",
        display_name=name,
        description=desc,
        config_schema={"type": "object"},
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        default_timeout_ms=30_000,
        required_capabilities=("browser",),
        side_effect_level=level,
    )


def _page(ctx: ExecutionContext) -> Any:
    if ctx.browser_session is None:
        raise RuntimeError("browser session missing")
    return ctx.browser_session.page()


def _locator(ctx: ExecutionContext) -> Any:
    loc = ctx.input("locator")
    if loc is not None and not isinstance(loc, str):
        return loc
    selector = ctx.config("selector") or ctx.input("selector")
    return _page(ctx).locator(str(selector))


class PageGoto:
    spec = _spec("page.goto", "Go to URL", "Navigate the page")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        from browserflow.infrastructure.network_policy import BrowserRequestNetworkPolicy

        url = str(ctx.input("url", ctx.config("url")))
        BrowserRequestNetworkPolicy().assert_url_allowed(url)
        page = _page(ctx)
        await page.goto(url, wait_until=str(ctx.config("wait_until", "load")))
        return NodeResult.success({"url": page.url, "title": await page.title()})


class PageReload:
    spec = _spec("page.reload", "Reload", "Reload the page")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        page = _page(ctx)
        await page.reload()
        return NodeResult.success({"url": page.url})


class PageTitle:
    spec = _spec("page.title", "Title", "Read document title", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        return NodeResult.success({"value": await _page(ctx).title()})


class PageUrl:
    spec = _spec("page.url", "URL", "Read page URL", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        return NodeResult.success({"value": _page(ctx).url})


class PageScreenshot:
    spec = _spec("page.screenshot", "Screenshot", "Capture the page")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        page = _page(ctx)
        data = await page.screenshot(type="png")
        if ctx.artifact_service is None:
            return NodeResult.success({"bytes": len(data)})
        stored = await ctx.artifact_service.write_bytes(
            ctx.execution_id,
            f"screenshots/{ctx.node_id}.png",
            data,
            node_id=ctx.node_id,
            content_type="image/png",
            kind="screenshot",
        )
        return NodeResult.success({"path": stored.relative_path, "size": stored.size_bytes})


class PageWaitForURL:
    spec = _spec("page.waitForURL", "Wait for URL", "Wait until URL matches")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        pattern = str(ctx.config("url"))
        await _page(ctx).wait_for_url(pattern)
        return NodeResult.success({"url": _page(ctx).url})


class PageWaitForLoadState:
    spec = _spec("page.waitForLoadState", "Wait for load", "Wait for load state")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        state = str(ctx.config("state", "load"))
        await _page(ctx).wait_for_load_state(state)
        return NodeResult.success({"state": state})


class LocatorCss:
    spec = _spec("locator.css", "CSS locator", "Create a CSS locator", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        selector = str(ctx.config("selector"))
        loc = _page(ctx).locator(selector)
        ctx.scope.set_runtime("locator", loc)
        return NodeResult.success({"selector": selector})


class LocatorText:
    spec = _spec("locator.text", "Text locator", "Create a text locator", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        text = str(ctx.config("text"))
        loc = _page(ctx).get_by_text(text)
        ctx.scope.set_runtime("locator", loc)
        return NodeResult.success({"text": text})


class LocatorRole:
    spec = _spec("locator.role", "Role locator", "Create a role locator", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        role = str(ctx.config("role"))
        name = ctx.config("name")
        loc = _page(ctx).get_by_role(role, name=name)
        ctx.scope.set_runtime("locator", loc)
        return NodeResult.success({"role": role})


class LocatorFirst:
    spec = _spec("locator.first", "First", "First matching locator", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        loc = _locator(ctx).first
        ctx.scope.set_runtime("locator", loc)
        return NodeResult.success({})


class LocatorNth:
    spec = _spec("locator.nth", "Nth", "Nth matching locator", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        index = int(ctx.config("index", 0))
        loc = _locator(ctx).nth(index)
        ctx.scope.set_runtime("locator", loc)
        return NodeResult.success({"index": index})


class LocatorCount:
    spec = _spec("locator.count", "Count", "Count matches", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        count = await _locator(ctx).count()
        return NodeResult.success({"value": count})


class LocatorWaitFor:
    spec = _spec("locator.waitFor", "Wait for locator", "Wait for element state")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        state = str(ctx.config("state", "visible"))
        await _locator(ctx).wait_for(state=state)
        return NodeResult.success({"state": state})


class ElementClick:
    spec = _spec("element.click", "Click", "Click an element")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await _locator(ctx).click()
        return NodeResult.success({})


class ElementFill:
    spec = _spec("element.fill", "Fill", "Fill an input")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        value = str(ctx.input("value", ctx.config("value") or ""))
        await _locator(ctx).fill(value)
        return NodeResult.success({})


class ElementPress:
    spec = _spec("element.press", "Press", "Press a key")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        key = str(ctx.config("key"))
        await _locator(ctx).press(key)
        return NodeResult.success({"key": key})


class ElementSelectOption:
    spec = _spec("element.selectOption", "Select", "Select an option")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        value = ctx.input("value", ctx.config("value"))
        await _locator(ctx).select_option(value)
        return NodeResult.success({})


class ElementCheck:
    spec = _spec("element.check", "Check", "Check a checkbox")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await _locator(ctx).check()
        return NodeResult.success({})


class ElementInnerText:
    spec = _spec("element.innerText", "Inner text", "Read innerText", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        text = await _locator(ctx).inner_text()
        return NodeResult.success({"value": text})


class ElementTextContent:
    spec = _spec("element.textContent", "Text content", "Read textContent", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        text = await _locator(ctx).text_content()
        return NodeResult.success({"value": text})


class ElementGetAttribute:
    spec = _spec("element.getAttribute", "Get attribute", "Read attribute", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        name = str(ctx.config("name"))
        value = await _locator(ctx).get_attribute(name)
        return NodeResult.success({"value": value})


class ElementIsVisible:
    spec = _spec("element.isVisible", "Is visible", "Visibility check", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        visible = await _locator(ctx).is_visible()
        return NodeResult.success({"value": visible})


BROWSER_NODES = [
    PageGoto(),
    PageReload(),
    PageTitle(),
    PageUrl(),
    PageScreenshot(),
    PageWaitForURL(),
    PageWaitForLoadState(),
    LocatorCss(),
    LocatorText(),
    LocatorRole(),
    LocatorFirst(),
    LocatorNth(),
    LocatorCount(),
    LocatorWaitFor(),
    ElementClick(),
    ElementFill(),
    ElementPress(),
    ElementSelectOption(),
    ElementCheck(),
    ElementInnerText(),
    ElementTextContent(),
    ElementGetAttribute(),
    ElementIsVisible(),
]
