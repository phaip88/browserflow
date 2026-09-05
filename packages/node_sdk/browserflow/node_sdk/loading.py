from __future__ import annotations

from browserflow.node_sdk.registry import NodeRegistry


def load_release1_nodes(registry: NodeRegistry) -> None:
    from browserflow.node_pack_browser.nodes import BROWSER_NODES
    from browserflow.node_pack_control.nodes import CONTROL_NODES
    from browserflow.node_pack_data.nodes import DATA_NODES
    from browserflow.node_pack_integration.nodes import INTEGRATION_NODES

    for handler in (*CONTROL_NODES, *DATA_NODES, *BROWSER_NODES, *INTEGRATION_NODES):
        registry.register(handler)
