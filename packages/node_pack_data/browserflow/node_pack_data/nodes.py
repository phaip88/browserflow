from __future__ import annotations

import json
import secrets
import string

from browserflow.node_sdk.context import ExecutionContext
from browserflow.node_sdk.result import NodeResult
from browserflow.node_sdk.spec import NodeSpec


def _spec(type_: str, name: str, desc: str) -> NodeSpec:
    return NodeSpec(
        type=type_,
        version="1",
        category="data",
        display_name=name,
        description=desc,
        config_schema={"type": "object"},
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )


class ConstantNode:
    spec = _spec("data.constant", "Constant", "Emit a constant value")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        return NodeResult.success({"value": ctx.config("value")})


class SetVariableNode:
    spec = _spec("data.setVariable", "Set variable", "Write a scope variable")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        name = str(ctx.config("name"))
        value = ctx.input("value", ctx.config("value"))
        ctx.set_variable(name, value)
        return NodeResult.success({"name": name, "value": value})


class GetVariableNode:
    spec = _spec("data.getVariable", "Get variable", "Read a scope variable")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        name = str(ctx.config("name"))
        value = ctx.get_variable(name)
        return NodeResult.success({"value": value})


class TemplateNode:
    spec = _spec("data.template", "Template", "Interpolate {{variables}}")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        template = str(ctx.config("template", ""))
        rendered = _render(template, ctx)
        return NodeResult.success({"value": rendered})


class JsonParseNode:
    spec = _spec("data.jsonParse", "JSON parse", "Parse JSON text")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        raw = ctx.input("value", ctx.config("value"))
        try:
            parsed = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            return NodeResult.failure("BF-NODE", "invalid JSON")
        return NodeResult.success({"value": parsed})


class JsonStringifyNode:
    spec = _spec("data.jsonStringify", "JSON stringify", "Serialize JSON")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        value = ctx.input("value", ctx.config("value"))
        return NodeResult.success({"value": json.dumps(value, default=str)})


class CompareNode:
    spec = _spec("data.compare", "Compare", "Compare two values")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        left = ctx.input("left", ctx.config("left"))
        right = ctx.input("right", ctx.config("right"))
        op = ctx.config("op", "eq")
        from browserflow.node_pack_control.nodes import _compare

        result = _compare(left, op, right)
        return NodeResult.success({"value": result}, branch="TRUE" if result else "FALSE")


class RandomStringNode:
    spec = _spec("data.randomString", "Random string", "Generate a random token")

    async def run(self, ctx: ExecutionContext) -> NodeResult:
        await ctx.checkpoint()
        length = int(ctx.config("length", 16))
        length = max(1, min(length, 256))
        alphabet = string.ascii_letters + string.digits
        value = "".join(secrets.choice(alphabet) for _ in range(length))
        return NodeResult.success({"value": value})


def _render(template: str, ctx: ExecutionContext) -> str:
    out = template
    i = 0
    while True:
        start = out.find("{{", i)
        if start < 0:
            break
        end = out.find("}}", start)
        if end < 0:
            break
        key = out[start + 2 : end].strip()
        try:
            value = ctx.get_variable(key, "")
        except Exception:
            value = ""
        replacement = "" if value is None else str(value)
        out = out[:start] + replacement + out[end + 2 :]
        i = start + len(replacement)
    return out


DATA_NODES = [
    ConstantNode(),
    SetVariableNode(),
    GetVariableNode(),
    TemplateNode(),
    JsonParseNode(),
    JsonStringifyNode(),
    CompareNode(),
    RandomStringNode(),
]
