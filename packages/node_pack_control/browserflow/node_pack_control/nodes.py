from __future__ import annotations

import asyncio
from typing import Any

from browserflow.node_sdk.context import ExecutionContext
from browserflow.node_sdk.result import NodeResult
from browserflow.node_sdk.spec import NodeSpec


def _spec(type_: str, name: str, desc: str, **kwargs: Any) -> NodeSpec:
    return NodeSpec(
        type=type_,
        version="1",
        category="control",
        display_name=name,
        description=desc,
        config_schema={"type": "object"},
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        **kwargs,
    )


class StartNode:
    spec = _spec("control.start", "Start", "Flow entry")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        return NodeResult.success({})


class EndNode:
    spec = _spec("control.end", "End", "Flow exit")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        return NodeResult.success({})


class IfNode:
    spec = _spec("control.if", "If", "Boolean branch")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        left = ctx.input("left", ctx.config("left"))
        op = ctx.config("op", "eq")
        right = ctx.input("right", ctx.config("right"))
        result = _compare(left, op, right)
        return NodeResult.success({"value": result}, branch="TRUE" if result else "FALSE")


class ForeachNode:
    spec = _spec("control.foreach", "For each", "Sequential loop")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        items = ctx.input("items", ctx.config("items") or [])
        if not isinstance(items, list):
            return NodeResult.failure("BF-NODE", "foreach items must be a list")
        return NodeResult.success({"items": items, "length": len(items)})


class WaitNode:
    spec = _spec("control.wait", "Wait", "Sleep for duration")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        ms = int(ctx.config("duration_ms", 0) or 0)
        remaining = ms / 1000
        while remaining > 0:
            await ctx.checkpoint()
            step = min(remaining, 0.2)
            await asyncio.sleep(step)
            remaining -= step
        return NodeResult.success({"waited_ms": ms})


class FailNode:
    spec = _spec("control.fail", "Fail", "Fail the flow")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        message = str(ctx.config("message", "failed"))
        return NodeResult.failure("BF-NODE", message)


class ReturnNode:
    spec = _spec("control.return", "Return", "Return a value and stop")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        value = ctx.input("value", ctx.config("value"))
        return NodeResult.returned(value)


def _compare(left: Any, op: str, right: Any) -> bool:
    if op in {"eq", "=="}:
        return left == right
    if op in {"neq", "!="}:
        return left != right
    if op in {"gt", ">"}:
        return left > right
    if op in {"gte", ">="}:
        return left >= right
    if op in {"lt", "<"}:
        return left < right
    if op in {"lte", "<="}:
        return left <= right
    if op == "contains":
        return right in left if left is not None else False
    if op == "truthy":
        return bool(left)
    return bool(left)


CONTROL_NODES = [
    StartNode(),
    EndNode(),
    IfNode(),
    ForeachNode(),
    WaitNode(),
    FailNode(),
    ReturnNode(),
]
