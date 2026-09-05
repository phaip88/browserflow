from __future__ import annotations

import httpx
from browserflow.domain.enums import SideEffectLevel
from browserflow.node_sdk.context import ExecutionContext
from browserflow.node_sdk.result import NodeResult
from browserflow.node_sdk.spec import NodeSpec


def _spec(type_: str, name: str, desc: str, level: SideEffectLevel) -> NodeSpec:
    return NodeSpec(
        type=type_,
        version="1",
        category="integration",
        display_name=name,
        description=desc,
        config_schema={"type": "object"},
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        side_effect_level=level,
        required_capabilities=("http",) if type_ == "integration.httpRequest" else (),
        sensitive_fields=("headers", "body") if type_ == "integration.httpRequest" else (),
    )


class HttpRequestNode:
    spec = _spec(
        "integration.httpRequest", "HTTP request", "Outbound HTTP", SideEffectLevel.EXTERNAL
    )

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        from browserflow.infrastructure.network_policy import HttpRequestNetworkPolicy

        url = str(ctx.input("url", ctx.config("url") or ""))
        method = str(ctx.config("method", "GET")).upper()
        policy = HttpRequestNetworkPolicy()
        try:
            policy.assert_url_allowed(url)
        except Exception as exc:
            return NodeResult.failure("BF-NETWORK", str(exc))
        headers = ctx.config("headers") or {}
        body = ctx.input("body", ctx.config("body"))
        timeout = min(int(ctx.config("timeout_ms", 15000)) / 1000, 30)
        async with httpx.AsyncClient(follow_redirects=False, timeout=timeout) as client:
            current = url
            for _ in range(5):
                policy.assert_url_allowed(current)
                response = await client.request(
                    method, current, headers=headers, json=body if method != "GET" else None
                )
                if response.is_redirect:
                    nxt = response.headers.get("location")
                    if not nxt:
                        break
                    current = str(response.url.join(nxt))
                    continue
                text = response.text[: 256 * 1024]
                return NodeResult.success(
                    {
                        "status": response.status_code,
                        "body": text,
                        "headers": dict(response.headers),
                    }
                )
        return NodeResult.failure("BF-NETWORK", "too many redirects")


class ReadFileNode:
    spec = _spec("integration.readFile", "Read file", "Read a sandboxed file", SideEffectLevel.READ)

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        rel = str(ctx.config("path"))
        if ctx.artifact_service is None:
            return NodeResult.failure("BF-FILE", "artifact service missing")
        data = await ctx.artifact_service.read_text(ctx.execution_id, rel)
        return NodeResult.success({"value": data})


class WriteFileNode:
    spec = _spec(
        "integration.writeFile", "Write file", "Write a sandboxed file", SideEffectLevel.WRITE
    )

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        rel = str(ctx.config("path"))
        content = str(ctx.input("value", ctx.config("value") or ""))
        if ctx.artifact_service is None:
            return NodeResult.failure("BF-FILE", "artifact service missing")
        artifact = await ctx.artifact_service.write_text(
            ctx.execution_id, rel, content, node_id=ctx.node_id
        )
        return NodeResult.success({"path": artifact.relative_path, "size": artifact.size_bytes})


class NotifyNode:
    spec = _spec(
        "integration.notify", "Notify", "Record a notification event", SideEffectLevel.WRITE
    )

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        message = str(ctx.input("message", ctx.config("message") or ""))
        return NodeResult.success({"message": message})


INTEGRATION_NODES = [HttpRequestNode(), ReadFileNode(), WriteFileNode(), NotifyNode()]
