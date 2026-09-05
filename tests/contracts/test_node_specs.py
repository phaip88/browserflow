from __future__ import annotations

import pytest
from browserflow.node_sdk.loading import load_release1_nodes
from browserflow.node_sdk.registry import NodeRegistry

pytestmark = pytest.mark.contract

REQUIRED = {
    "control.start",
    "control.end",
    "control.if",
    "control.foreach",
    "control.wait",
    "control.fail",
    "control.return",
    "page.goto",
    "page.reload",
    "page.title",
    "page.url",
    "page.screenshot",
    "page.waitForURL",
    "page.waitForLoadState",
    "locator.css",
    "locator.text",
    "locator.role",
    "locator.first",
    "locator.nth",
    "locator.count",
    "locator.waitFor",
    "element.click",
    "element.fill",
    "element.press",
    "element.selectOption",
    "element.check",
    "element.innerText",
    "element.textContent",
    "element.getAttribute",
    "element.isVisible",
    "data.constant",
    "data.setVariable",
    "data.getVariable",
    "data.template",
    "data.jsonParse",
    "data.jsonStringify",
    "data.compare",
    "data.randomString",
    "integration.httpRequest",
    "integration.readFile",
    "integration.writeFile",
    "integration.notify",
}


def test_all_release1_nodes_registered() -> None:
    registry = NodeRegistry()
    load_release1_nodes(registry)
    types = set(registry.types())
    missing = REQUIRED - types
    assert not missing, missing
    for spec in registry.specs():
        assert spec.type
        assert spec.version
        assert spec.config_schema
        assert spec.input_schema
        assert spec.output_schema
        assert spec.default_timeout_ms > 0
