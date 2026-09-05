import { useMutation, useQuery } from "@tanstack/react-query";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import { api } from "../api/client";

export function FlowEditorPage() {
  const { t } = useTranslation();
  const { flowId } = useParams();
  const detail = useQuery({
    queryKey: ["flow", flowId],
    queryFn: () =>
      api<{ id: string; name: string; draft: { nodes: Node[]; edges: Edge[] } | null }>(
        `/flows/${flowId}`,
      ),
    enabled: Boolean(flowId),
  });
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const draft = detail.data?.draft;
    if (!draft) {
      return;
    }
    setNodes(
      (draft.nodes ?? []).map((node) => ({
        ...node,
        position: (node as { position?: { x: number; y: number } }).position ?? { x: 0, y: 0 },
        data: { label: (node.data as { label?: string } | undefined)?.label ?? node.id },
      })),
    );
    setEdges(draft.edges ?? []);
  }, [detail.data, setEdges, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, type: "smoothstep" }, eds)),
    [setEdges],
  );

  const save = useMutation({
    mutationFn: () =>
      api(`/flows/${flowId}/draft`, {
        method: "PUT",
        body: JSON.stringify({
          definition: {
            schema_version: 1,
            nodes: nodes.map((n) => ({
              id: n.id,
              type: String(n.type ?? "data.constant"),
              version: "1",
              position: n.position,
              label: String(n.data.label ?? n.id),
              config: {},
            })),
            edges: edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              kind: "SUCCESS",
            })),
          },
        }),
      }),
  });

  const publish = useMutation({
    mutationFn: () => api(`/flows/${flowId}/publish`, { method: "POST" }),
  });
  const run = useMutation({
    mutationFn: () => api(`/flows/${flowId}/run`, { method: "POST" }),
  });

  return (
    <section className="editor-page">
      <header className="page-head">
        <h1>{detail.data?.name ?? t("flows.editor")}</h1>
        <div className="row">
          <button type="button" onClick={() => save.mutate()}>
            {t("flows.save")}
          </button>
          <button type="button" onClick={() => publish.mutate()}>
            {t("flows.publish")}
          </button>
          <button type="button" className="primary" onClick={() => run.mutate()}>
            {t("flows.run")}
          </button>
        </div>
      </header>
      <div className="canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background />
        </ReactFlow>
      </div>
    </section>
  );
}
