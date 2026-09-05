"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, applyEdgeChanges, useReactFlow, type Node, type Edge, type NodeChange, type EdgeChange, type Connection, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, fmtDate, queryClient, type Diagnostic, type FlowSummary } from "@/lib/api";
import { Badge, Button, ErrorText, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import type { FlowDefinition, FlowNode, FlowEdge, InputBinding, EdgeKind, FieldSpec } from "@/flow/schema";
import type { NodeMeta } from "@/nodes/catalog";

const KIND_COLORS: Record<EdgeKind, string> = { SUCCESS: "#6366f1", TRUE: "#059669", FALSE: "#d97706", ERROR: "#dc2626", LOOP_BODY: "#0891b2", LOOP_DONE: "#7c3aed", FINALLY: "#64748b" };
const CAT_COLORS: Record<string, string> = { control: "border-slate-400", page: "border-indigo-400", locator: "border-cyan-400", element: "border-emerald-400", data: "border-amber-400", integration: "border-pink-400" };
type BFNode = Node<{ flowNode: FlowNode; meta?: NodeMeta; diag?: "ERROR" | "WARNING" }, "bf">;

function BFNodeView({ data, selected }: NodeProps<BFNode>) {
  const { flowNode: n, meta } = data;
  const handles: EdgeKind[] = [...(meta?.sourceHandles ?? ["SUCCESS"])];
  if (n.errorPolicy?.mode === "FOLLOW_ERROR_EDGE" && n.type !== "control.start") handles.push("ERROR");
  return (
    <div className={`min-w-[170px] rounded-md border-2 bg-white px-3 py-2 text-xs shadow ${CAT_COLORS[meta?.category ?? ""] ?? "border-gray-300"} ${selected ? "ring-2 ring-indigo-400" : ""} ${data.diag === "ERROR" ? "outline outline-2 outline-red-500" : data.diag === "WARNING" ? "outline outline-2 outline-amber-400" : ""}`}>
      {meta?.acceptsIncoming !== false && <Handle type="target" position={Position.Left} className="!h-3 !w-3 !bg-gray-500" />}
      <div className="font-semibold text-gray-800">{n.label ?? meta?.displayName ?? n.type}</div>
      <div className="font-mono text-[10px] text-gray-500">{n.id} · {n.type}</div>
      {handles.map((k, i) => <Handle key={k} id={k} type="source" position={Position.Right} style={{ top: `${((i + 1) / (handles.length + 1)) * 100}%`, background: KIND_COLORS[k] }} className="!h-3 !w-3" title={k} />)}
      {handles.length > 1 && <div className="mt-1 flex flex-col items-end gap-0.5">{handles.map((k) => <span key={k} className="text-[9px]" style={{ color: KIND_COLORS[k] }}>{k}</span>)}</div>}
    </div>
  );
}
const nodeTypes = { bf: BFNodeView };

function Editor() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const rf = useReactFlow();
  const flowQ = useQuery({ queryKey: ["flow", id], queryFn: () => api<{ flow: FlowSummary & { draftDefinition: FlowDefinition }; versions: { id: string; versionNumber: number; createdAt: string; notes: string; flowChecksum: string }[] }>(`/flows/${id}`) });
  const catalog = useQuery({ queryKey: ["nodes"], queryFn: () => api<{ nodes: NodeMeta[] }>("/nodes"), staleTime: Infinity });
  const identities = useQuery({ queryKey: ["identities"], queryFn: () => api<{ identities: { id: string; name: string }[] }>("/identities") });
  const metaByType = useMemo(() => new Map((catalog.data?.nodes ?? []).map((m) => [m.type, m])), [catalog.data]);

  const [def, setDefState] = useState<FlowDefinition | null>(null);
  const [flowVersion, setFlowVersion] = useState(0);
  const history = useRef<{ past: FlowDefinition[]; future: FlowDefinition[] }>({ past: [], future: [] });
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error" | "conflict">("saved");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[] | null>(null);
  const [estimate, setEstimate] = useState<Record<string, unknown> | null>(null);
  const [search, setSearch] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const clipboard = useRef<FlowNode[]>([]);

  useEffect(() => {
    if (flowQ.data && !def) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDefState(flowQ.data.flow.draftDefinition);
      setFlowVersion(flowQ.data.flow.version);
    }
  }, [flowQ.data, def]);

  const setDef = useCallback((updater: (d: FlowDefinition) => FlowDefinition, record = true) => {
    setDefState((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      if (next === prev) return prev;
      if (record) {
        history.current.past = [...history.current.past.slice(-50), prev];
        history.current.future = [];
      }
      setDirty(true);
      return next;
    });
  }, []);
  const undo = useCallback(() => { const p = history.current.past.pop(); if (p) { setDefState((cur) => { if (cur) history.current.future.push(cur); return p; }); setDirty(true); } }, []);
  const redo = useCallback(() => { const f = history.current.future.pop(); if (f) { setDefState((cur) => { if (cur) history.current.past.push(cur); return f; }); setDirty(true); } }, []);

  // Debounced autosave with optimistic concurrency.
  const save = useMutation({
    mutationFn: async (d: FlowDefinition) => api<{ flow: FlowSummary }>(`/flows/${id}/draft`, { method: "PUT", body: { definition: d, expectedVersion: flowVersion } }),
    onMutate: () => setSaveState("saving"),
    onSuccess: (r) => { setFlowVersion(r.flow.version); setSaveState("saved"); setDirty(false); },
    onError: (e) => setSaveState((e as { code?: string }).code === "BF-FLOW-CONFLICT" ? "conflict" : "error"),
  });
  const saveNow = useCallback(() => { if (def) save.mutate(def); }, [def, save]);
  useEffect(() => {
    if (!dirty || !def) return;
    const t = setTimeout(() => save.mutate(def), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, dirty]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const compile = useMutation({ mutationFn: () => api<{ ok: boolean; diagnostics: Diagnostic[]; estimate: Record<string, unknown> | null }>(`/flows/${id}/compile`, { method: "POST", body: { definition: def } }), onSuccess: (r) => { setDiagnostics(r.diagnostics); setEstimate(r.estimate); } });
  const publish = useMutation({
    mutationFn: async () => { if (def && dirty) await save.mutateAsync(def); return api<{ ok: boolean; diagnostics: Diagnostic[]; version?: { versionNumber: number } }>(`/flows/${id}/publish`, { method: "POST", body: {} }); },
    onSuccess: (r) => { setDiagnostics(r.diagnostics); queryClient.invalidateQueries({ queryKey: ["flow", id] }); setMsg(r.ok ? `Published v${r.version?.versionNumber}` : "Publish blocked by compiler errors"); },
    onError: (e) => { const d = (e as { details?: { diagnostics?: Diagnostic[] } }).details; if (d?.diagnostics) setDiagnostics(d.diagnostics); setMsg((e as Error).message); },
  });
  const run = useMutation({ mutationFn: () => api<{ execution: { id: string } }>(`/flows/${id}/run`, { method: "POST", body: {} }), onSuccess: (r) => router.push(`/executions/${r.execution.id}`), onError: (e) => setMsg((e as Error).message) });
  const restore = useMutation({ mutationFn: (vid: string) => api(`/flows/${id}/versions/${vid}/restore`, { method: "POST", body: {} }), onSuccess: async () => { setDefState(null); await queryClient.invalidateQueries({ queryKey: ["flow", id] }); setShowVersions(false); } });

  // ---- React Flow projections
  const diagByNode = useMemo(() => { const m = new Map<string, "ERROR" | "WARNING">(); for (const d of diagnostics ?? []) if (d.nodeId && d.severity !== "INFO" && m.get(d.nodeId) !== "ERROR") m.set(d.nodeId, d.severity); return m; }, [diagnostics]);
  const rfNodes: BFNode[] = useMemo(() => (def?.nodes ?? []).map((n) => ({ id: n.id, type: "bf", position: n.position, selected: n.id === selectedNode, data: { flowNode: n, meta: metaByType.get(n.type), diag: diagByNode.get(n.id) } })), [def, metaByType, selectedNode, diagByNode]);
  const rfEdges: Edge[] = useMemo(() => (def?.edges ?? []).map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.kind, label: e.kind === "SUCCESS" ? undefined : e.kind, selected: e.id === selectedEdge, style: { stroke: KIND_COLORS[e.kind], strokeWidth: 2 }, labelStyle: { fontSize: 9, fill: KIND_COLORS[e.kind] }, animated: e.kind === "LOOP_BODY" })), [def, selectedEdge]);

  const onNodesChange = useCallback((changes: NodeChange<BFNode>[]) => {
    const positional = changes.filter((c) => c.type === "position" || c.type === "remove" || c.type === "select");
    if (positional.length === 0) return;
    const sel = changes.find((c) => c.type === "select");
    if (sel && sel.type === "select") { setSelectedNode(sel.selected ? sel.id : null); if (sel.selected) setSelectedEdge(null); }
    const removals = changes.filter((c) => c.type === "remove").map((c) => c.id);
    const moved = changes.filter((c) => c.type === "position" && c.position && !c.dragging);
    const dragging = changes.filter((c) => c.type === "position" && c.position && c.dragging);
    if (dragging.length) setDef((d) => { const applied = applyNodeChanges(dragging, rfNodes); return { ...d, nodes: d.nodes.map((n) => { const a = applied.find((x) => x.id === n.id); return a ? { ...n, position: a.position } : n; }) }; }, false);
    if (moved.length || removals.length) setDef((d) => ({ ...d, nodes: d.nodes.filter((n) => !removals.includes(n.id) || n.type === "control.start").map((n) => { const m = moved.find((c) => c.type === "position" && c.id === n.id); return m && m.type === "position" && m.position ? { ...n, position: m.position } : n; }), edges: d.edges.filter((e) => !removals.includes(e.source) && !removals.includes(e.target)) }));
  }, [rfNodes, setDef]);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const sel = changes.find((c) => c.type === "select");
    if (sel && sel.type === "select") { setSelectedEdge(sel.selected ? sel.id : null); if (sel.selected) setSelectedNode(null); }
    const removals = changes.filter((c) => c.type === "remove").map((c) => c.id);
    if (removals.length) setDef((d) => ({ ...d, edges: applyEdgeChanges(changes, rfEdges).length >= 0 ? d.edges.filter((e) => !removals.includes(e.id)) : d.edges }));
  }, [rfEdges, setDef]);
  const onConnect = useCallback((c: Connection) => {
    if (!c.source || !c.target || c.source === c.target) return;
    const kind = (c.sourceHandle as EdgeKind) || "SUCCESS";
    const tmeta = metaByType.get(def?.nodes.find((n) => n.id === c.target)?.type ?? "");
    if (tmeta && !tmeta.acceptsIncoming) return;
    setDef((d) => ({ ...d, edges: [...d.edges, { id: `e_${Date.now().toString(36)}`, source: c.source!, target: c.target!, kind, priority: 100 }] }));
  }, [def, metaByType, setDef]);

  const addNode = useCallback((type: string, position?: { x: number; y: number }) => {
    const meta = metaByType.get(type);
    if (!meta) return;
    setDef((d) => {
      const base = type.split(".")[1] ?? "node";
      let i = 1;
      while (d.nodes.some((n) => n.id === `${base}${i}`)) i++;
      const config: Record<string, unknown> = {};
      for (const f of meta.fields) if (f.default !== undefined) config[f.name] = f.default;
      const pos = position ?? { x: 120 + d.nodes.length * 30, y: 120 + d.nodes.length * 20 };
      return { ...d, nodes: [...d.nodes, { id: `${base}${i}`, type, version: meta.version, position: pos, label: meta.displayName, config, inputs: {} }] };
    });
  }, [metaByType, setDef]);
  const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); const type = e.dataTransfer.getData("application/bf-node"); if (type) addNode(type, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })); }, [addNode, rf]);
  const updateNode = useCallback((nodeId: string, patch: Partial<FlowNode>) => setDef((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)) })), [setDef]);
  const autoLayout = useCallback(() => setDef((d) => {
    const depth = new Map<string, number>();
    const incoming = new Map<string, number>();
    d.nodes.forEach((n) => incoming.set(n.id, 0));
    d.edges.forEach((e) => incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1));
    const queue = d.nodes.filter((n) => (incoming.get(n.id) ?? 0) === 0).map((n) => n.id);
    queue.forEach((q) => depth.set(q, 0));
    while (queue.length) { const cur = queue.shift()!; for (const e of d.edges.filter((x) => x.source === cur)) { const nd = (depth.get(cur) ?? 0) + 1; if ((depth.get(e.target) ?? -1) < nd) { depth.set(e.target, nd); queue.push(e.target); } } }
    const perCol = new Map<number, number>();
    return { ...d, nodes: d.nodes.map((n) => { const c = depth.get(n.id) ?? 0; const r = perCol.get(c) ?? 0; perCol.set(c, r + 1); return { ...n, position: { x: 60 + c * 260, y: 60 + r * 130 } }; }) };
  }), [setDef]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (e.key === "y" || (e.key === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (mod && e.key === "s") { e.preventDefault(); saveNow(); }
      else if (mod && e.key === "c" && def) { clipboard.current = def.nodes.filter((n) => rfNodes.find((r) => r.id === n.id && r.selected) && n.type !== "control.start"); }
      else if (mod && e.key === "v" && clipboard.current.length) { e.preventDefault(); setDef((d) => { const idMap = new Map<string, string>(); const copies = clipboard.current.map((n) => { let i = 1; let nid = `${n.id}_copy${i}`; while (d.nodes.some((x) => x.id === nid) || idMap.has(nid)) nid = `${n.id}_copy${++i}`; idMap.set(n.id, nid); return { ...structuredClone(n), id: nid, position: { x: n.position.x + 40, y: n.position.y + 40 } }; }); const copiedEdges = d.edges.filter((ed) => idMap.has(ed.source) && idMap.has(ed.target)).map((ed) => ({ ...ed, id: `${ed.id}_c${Date.now().toString(36)}`, source: idMap.get(ed.source)!, target: idMap.get(ed.target)! })); return { ...d, nodes: [...d.nodes, ...copies], edges: [...d.edges, ...copiedEdges] }; }); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [def, rfNodes, undo, redo, saveNow, setDef]);

  if (!def || !catalog.data) return <div className="p-8 text-gray-400">Loading editor…</div>;
  const flow = flowQ.data!.flow;
  const selNode = def.nodes.find((n) => n.id === selectedNode) ?? null;
  const selEdge = def.edges.find((e) => e.id === selectedEdge) ?? null;
  const errors = (diagnostics ?? []).filter((d) => d.severity === "ERROR").length;
  const groups = ["control", "page", "locator", "element", "data", "integration"];

  return (
    <div className="-m-6 flex h-screen flex-col">
      <header className="flex items-center gap-2 border-b border-gray-200 bg-white px-4 py-2">
        <Link href="/flows" className="text-sm text-gray-500">← Flows</Link>
        <input className="ml-2 rounded border border-transparent px-2 py-1 font-semibold hover:border-gray-300 focus:border-indigo-400 focus:outline-none" value={def.name} onChange={(e) => setDef((d) => ({ ...d, name: e.target.value }))} />
        <span className={`text-xs ${saveState === "saved" && !dirty ? "text-emerald-600" : saveState === "conflict" || saveState === "error" ? "text-red-600" : "text-amber-600"}`}>{saveState === "conflict" ? "conflict — reload" : saveState === "error" ? "save failed" : dirty ? "unsaved…" : "saved"}</span>
        {flow.currentVersionId ? <Badge status="SUCCEEDED">published</Badge> : <Badge>draft</Badge>}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" onClick={undo} title="Undo (Ctrl+Z)">↶</Button><Button variant="ghost" onClick={redo} title="Redo (Ctrl+Y)">↷</Button>
          <Button variant="ghost" onClick={autoLayout}>Auto layout</Button>
          <Button variant="ghost" onClick={() => setShowSettings(true)}>Settings</Button>
          <Button variant="ghost" onClick={() => setShowVersions(true)}>Versions ({flowQ.data!.versions.length})</Button>
          <a className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100" href={`/api/flows/${id}/export`}>Export</a>
          <Button variant="secondary" onClick={saveNow} disabled={save.isPending}>Save</Button>
          <Button variant="secondary" onClick={() => compile.mutate()} disabled={compile.isPending}>Compile</Button>
          <Button onClick={() => publish.mutate()} disabled={publish.isPending}>Publish</Button>
          <Button variant="secondary" onClick={() => run.mutate()} disabled={!flow.currentVersionId || run.isPending} title={flow.currentVersionId ? "Run latest published version" : "Publish first"}>Run ▶</Button>
        </div>
      </header>
      {msg && <div className="flex items-center justify-between bg-indigo-50 px-4 py-1 text-xs text-indigo-800"><span>{msg}</span><button onClick={() => setMsg(null)}>✕</button></div>}
      <div className="flex min-h-0 flex-1">
        <aside className="w-56 shrink-0 overflow-auto border-r border-gray-200 bg-white p-2">
          <Input placeholder="Search nodes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          {groups.map((g) => { const items = catalog.data.nodes.filter((n) => n.category === g && (!search || n.displayName.toLowerCase().includes(search.toLowerCase()) || n.type.includes(search.toLowerCase()))); if (!items.length) return null; return <div key={g} className="mt-3"><div className="px-1 text-[10px] font-semibold uppercase text-gray-400">{g}</div>{items.map((n) => <div key={n.type} draggable onDragStart={(e) => e.dataTransfer.setData("application/bf-node", n.type)} onClick={() => addNode(n.type)} title={n.description} className={`mt-1 cursor-grab rounded border-l-4 bg-gray-50 px-2 py-1 text-xs hover:bg-indigo-50 ${CAT_COLORS[g]}`}>{n.displayName}</div>)}</div>; })}
        </aside>
        <div className="relative min-w-0 flex-1" onDrop={onDrop} onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}>
          <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onPaneClick={() => { setSelectedNode(null); setSelectedEdge(null); }} fitView deleteKeyCode={["Backspace", "Delete"]} multiSelectionKeyCode="Shift" selectionOnDrag={false} minZoom={0.1} maxZoom={2} onlyRenderVisibleElements>
            <Background /><Controls /><MiniMap pannable zoomable />
          </ReactFlow>
          {diagnostics && <div className="absolute bottom-0 left-0 right-0 max-h-48 overflow-auto border-t border-gray-200 bg-white/95 p-2 text-xs"><div className="mb-1 flex items-center justify-between font-semibold"><span>Compiler: {errors ? `${errors} error(s)` : "OK"} · {diagnostics.length} diagnostic(s){estimate ? ` · ${String(estimate.nodeCount)} nodes, ~${String(estimate.estimatedMaxSteps)} max steps${estimate.requiresBrowser ? ", browser" : ""}` : ""}</span><button onClick={() => setDiagnostics(null)}>✕</button></div>{diagnostics.map((d, i) => <div key={i} className={`cursor-pointer py-0.5 ${d.severity === "ERROR" ? "text-red-700" : d.severity === "WARNING" ? "text-amber-700" : "text-gray-600"}`} onClick={() => { if (d.nodeId) setSelectedNode(d.nodeId); }}>[{d.severity}] <span className="font-mono">{d.code}</span> {d.message}</div>)}</div>}
        </div>
        <aside className="w-80 shrink-0 overflow-auto border-l border-gray-200 bg-white p-3 text-sm">
          {selNode ? <NodeInspector node={selNode} meta={metaByType.get(selNode.type)} def={def} onChange={(p) => updateNode(selNode.id, p)} onDelete={() => selNode.type !== "control.start" && setDef((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== selNode.id), edges: d.edges.filter((e) => e.source !== selNode.id && e.target !== selNode.id) }))} />
            : selEdge ? <div className="space-y-3"><h3 className="font-semibold">Edge {selEdge.id}</h3><div className="text-xs text-gray-500">{selEdge.source} → {selEdge.target}</div><Field label="Kind"><Select value={selEdge.kind} onChange={(e) => setDef((d) => ({ ...d, edges: d.edges.map((x) => (x.id === selEdge.id ? { ...x, kind: e.target.value as EdgeKind } : x)) }))}>{Object.keys(KIND_COLORS).map((k) => <option key={k}>{k}</option>)}</Select></Field><Field label="Priority (lower runs first)"><Input type="number" value={selEdge.priority} onChange={(e) => setDef((d) => ({ ...d, edges: d.edges.map((x) => (x.id === selEdge.id ? { ...x, priority: Number(e.target.value) } : x)) }))} /></Field><Button variant="danger" onClick={() => setDef((d) => ({ ...d, edges: d.edges.filter((x) => x.id !== selEdge.id) }))}>Delete edge</Button></div>
            : <div className="text-gray-500"><h3 className="mb-2 font-semibold text-gray-800">Flow</h3><p className="text-xs">{def.nodes.length} nodes · {def.edges.length} edges</p><p className="mt-3 text-xs">Select a node or edge to edit it. Drag from the palette to add nodes; connect handles to create edges (handle colour = edge kind). Shortcuts: Ctrl+S save, Ctrl+Z/Y undo/redo, Ctrl+C/V copy/paste, Delete remove.</p><h4 className="mt-4 font-semibold text-gray-800">Variables</h4><VariablesEditor key={JSON.stringify(def.variables)} def={def} onChange={(variables) => setDef((d) => ({ ...d, variables }))} /></div>}
        </aside>
      </div>
      {showVersions && <Modal title="Version history" onClose={() => setShowVersions(false)}><ul className="space-y-2">{flowQ.data!.versions.map((v) => <li key={v.id} className="flex items-center justify-between rounded border border-gray-100 p-2"><div><div className="font-medium">v{v.versionNumber} {flow.currentVersionId === v.id && <Badge status="SUCCEEDED">current</Badge>}</div><div className="text-xs text-gray-500">{fmtDate(v.createdAt)} · {v.flowChecksum.slice(0, 12)}</div></div><div className="flex gap-1"><Button variant="secondary" onClick={() => { api<{ execution: { id: string } }>(`/flows/${id}/run`, { method: "POST", body: { flowVersionId: v.id } }).then((r) => router.push(`/executions/${r.execution.id}`)); }}>Run</Button><Button variant="ghost" onClick={() => { if (confirm("Replace the current draft with this version?")) restore.mutate(v.id); }}>Restore to draft</Button></div></li>)}{flowQ.data!.versions.length === 0 && <li className="text-gray-400">No published versions yet.</li>}</ul></Modal>}
      {showSettings && <Modal title="Flow settings" onClose={() => setShowSettings(false)}><div className="space-y-3">
        <Field label="Description"><Input value={def.description} onChange={(e) => setDef((d) => ({ ...d, description: e.target.value }))} /></Field>
        <Field label="Flow timeout (seconds)"><Input type="number" value={(def.settings.timeoutMs ?? 900000) / 1000} onChange={(e) => setDef((d) => ({ ...d, settings: { ...d.settings, timeoutMs: Math.max(1, Number(e.target.value)) * 1000 } }))} /></Field>
        <Field label="Max attempts (auto retry on worker loss)"><Input type="number" min={1} max={5} value={def.settings.maxAttempts} onChange={(e) => setDef((d) => ({ ...d, settings: { ...d.settings, maxAttempts: Number(e.target.value) } }))} /></Field>
        <Field label="Identity (persistent browser profile)"><Select value={def.settings.identityRef ?? ""} onChange={(e) => setDef((d) => ({ ...d, settings: { ...d.settings, identityRef: e.target.value || undefined } }))}><option value="">Ephemeral (none)</option>{identities.data?.identities.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={def.settings.screenshotOnNavigation} onChange={(e) => setDef((d) => ({ ...d, settings: { ...d.settings, screenshotOnNavigation: e.target.checked } }))} /> Screenshot after navigation</label>
      </div></Modal>}
    </div>
  );
}

function VariablesEditor({ def, onChange }: { def: FlowDefinition; onChange: (v: Record<string, unknown>) => void }) {
  const [text, setText] = useState(JSON.stringify(def.variables, null, 2));
  const [err, setErr] = useState<string | null>(null);
  return <div><Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { try { const v = JSON.parse(text); if (v && typeof v === "object" && !Array.isArray(v)) { onChange(v); setErr(null); } else setErr("Must be a JSON object"); } catch (e) { setErr((e as Error).message); } }} />{err && <p className="text-xs text-red-600">{err}</p>}</div>;
}

function FieldInput({ f, value, onChange }: { f: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  if (f.type === "boolean") return <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> <span>{f.label}</span></label>;
  if (f.type === "select") return <Field label={f.label} help={f.help}><Select value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}><option value="">—</option>{f.options?.map((o) => <option key={o}>{o}</option>)}</Select></Field>;
  if (f.type === "number") return <Field label={f.label} help={f.help}><Input type="number" value={value === undefined || value === null ? "" : String(value)} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} /></Field>;
  if (f.type === "json") return <JsonField f={f} value={value} onChange={onChange} />;
  if (f.type === "text" || f.type === "template") return <Field label={f.label} help={f.help ?? (f.type === "template" ? "Supports {{variable}} placeholders" : undefined)}><Textarea rows={2} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={f.sensitive ? "bg-amber-50" : ""} /></Field>;
  return <Field label={f.label} help={f.help}><Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={f.type === "credentialRef" ? "credential:<name>#<field>" : undefined} /></Field>;
}
function JsonField({ f, value, onChange }: { f: FieldSpec; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value));
  return <Field label={f.label} help="JSON (or plain text)"><Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} onBlur={() => { try { onChange(text.trim() === "" ? undefined : JSON.parse(text)); } catch { onChange(text); } }} /></Field>;
}

function NodeInspector({ node, meta, def, onChange, onDelete }: { node: FlowNode; meta?: NodeMeta; def: FlowDefinition; onChange: (p: Partial<FlowNode>) => void; onDelete: () => void }) {
  const upstream = def.nodes.filter((n) => n.id !== node.id);
  const variables = [...Object.keys(def.variables), ...def.nodes.map((n) => n.outputVariable).filter(Boolean), "item", "index", "length", "first", "last", "inputs", "error"] as string[];
  const setBinding = (name: string, b: InputBinding | undefined) => { const inputs = { ...node.inputs }; if (b) inputs[name] = b; else delete inputs[name]; onChange({ inputs }); };
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between"><div><h3 className="font-semibold">{meta?.displayName ?? node.type}</h3><p className="text-xs text-gray-500">{meta?.description}</p></div>{node.type !== "control.start" && <Button variant="ghost" className="text-red-600" onClick={onDelete}>Delete</Button>}</div>
      <Field label="Label"><Input value={node.label ?? ""} onChange={(e) => onChange({ label: e.target.value })} /></Field>
      <Field label="Node ID"><Input value={node.id} readOnly className="bg-gray-50 font-mono" /></Field>
      {meta && meta.fields.length > 0 && <div className="space-y-2 rounded border border-gray-100 p-2"><div className="text-xs font-semibold uppercase text-gray-400">Config</div>{meta.fields.map((f) => <FieldInput key={f.name} f={f} value={node.config[f.name]} onChange={(v) => onChange({ config: { ...node.config, [f.name]: v } })} />)}</div>}
      {meta && meta.inputs.length > 0 && <div className="space-y-2 rounded border border-gray-100 p-2"><div className="text-xs font-semibold uppercase text-gray-400">Inputs</div>
        {meta.inputs.map((port) => { const b = node.inputs[port.name]; const kind = b?.kind ?? "unbound"; return <div key={port.name} className="rounded bg-gray-50 p-2"><div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium">{port.name} <span className="text-gray-400">({port.type}{port.required ? ", required" : ""})</span></span><Select className="!w-28 !py-0.5 !text-xs" value={kind} onChange={(e) => { const k = e.target.value; setBinding(port.name, k === "unbound" ? undefined : k === "node" ? { kind: "node", nodeId: upstream[0]?.id ?? "", output: "" } : k === "variable" ? { kind: "variable", name: variables[0] ?? "" } : k === "literal" ? { kind: "literal", value: "" } : { kind: "template", template: "" }); }}><option value="unbound">unbound</option><option value="node">node output</option>{port.type !== "page" && port.type !== "locator" && <><option value="variable">variable</option><option value="literal">literal</option><option value="template">template</option></>}</Select></div>
          {b?.kind === "node" && <div className="flex gap-1"><Select className="!text-xs" value={b.nodeId} onChange={(e) => setBinding(port.name, { ...b, nodeId: e.target.value, output: "" })}>{upstream.map((u) => <option key={u.id} value={u.id}>{u.id}</option>)}</Select><Select className="!text-xs" value={b.output} onChange={(e) => setBinding(port.name, { ...b, output: e.target.value })}><option value="">output…</option>{(def.nodes.find((n) => n.id === b.nodeId) ? (metaOutputs(def, b.nodeId) ?? []) : []).map((o) => <option key={o} value={o}>{o}</option>)}</Select></div>}
          {b?.kind === "variable" && <Input list={`vars-${node.id}`} className="!text-xs" value={b.name} onChange={(e) => setBinding(port.name, { kind: "variable", name: e.target.value })} />}
          {b?.kind === "literal" && <Input className="!text-xs" value={typeof b.value === "string" ? b.value : JSON.stringify(b.value)} onChange={(e) => { let v: unknown = e.target.value; try { v = JSON.parse(e.target.value); } catch { /* keep string */ } setBinding(port.name, { kind: "literal", value: v }); }} />}
          {b?.kind === "template" && <Input className="!text-xs" value={b.template} onChange={(e) => setBinding(port.name, { kind: "template", template: e.target.value })} placeholder="{{variable}} or credential:name#field" />}
          <datalist id={`vars-${node.id}`}>{variables.map((v) => <option key={v} value={v} />)}</datalist>
        </div>; })}
      </div>}
      {meta && meta.outputs.length > 0 && <div className="rounded border border-gray-100 p-2"><div className="text-xs font-semibold uppercase text-gray-400">Outputs</div><div className="text-xs text-gray-600">{meta.outputs.map((o) => `${o.name}:${o.type}`).join(", ")}</div><Field label="Store output in variable" help="Single output stored directly; multiple outputs stored as object"><Input value={node.outputVariable ?? ""} onChange={(e) => onChange({ outputVariable: e.target.value || undefined })} placeholder="e.g. pageTitle" /></Field></div>}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Timeout (ms)"><Input type="number" value={node.timeoutMs ?? meta?.defaultTimeoutMs ?? 30000} onChange={(e) => onChange({ timeoutMs: Number(e.target.value) })} /></Field>
        <Field label="Retries"><Input type="number" min={1} max={10} value={node.retry?.maxAttempts ?? meta?.defaultRetryPolicy?.maxAttempts ?? 1} onChange={(e) => onChange({ retry: { maxAttempts: Number(e.target.value), backoffMs: node.retry?.backoffMs ?? 500 } })} /></Field>
      </div>
      <Field label="On error"><Select value={node.errorPolicy?.mode ?? "FAIL_FLOW"} onChange={(e) => onChange({ errorPolicy: { mode: e.target.value as NonNullable<FlowNode["errorPolicy"]>["mode"], defaultValue: node.errorPolicy?.defaultValue } })}><option value="FAIL_FLOW">Fail flow</option><option value="FOLLOW_ERROR_EDGE">Follow ERROR edge</option><option value="CONTINUE">Continue</option><option value="USE_DEFAULT_VALUE">Use default value</option></Select></Field>
      {node.errorPolicy?.mode === "USE_DEFAULT_VALUE" && <Field label="Default value (JSON)"><Input value={JSON.stringify(node.errorPolicy.defaultValue ?? null)} onChange={(e) => { try { onChange({ errorPolicy: { mode: "USE_DEFAULT_VALUE", defaultValue: JSON.parse(e.target.value) } }); } catch { /* wait for valid json */ } }} /></Field>}
    </div>
  );
}
const outputCache = new Map<string, string[]>();
function metaOutputs(def: FlowDefinition, nodeId: string): string[] | undefined {
  const n = def.nodes.find((x) => x.id === nodeId);
  if (!n) return undefined;
  if (!outputCache.has(n.type)) {
    // populated lazily from the catalog query cache
    const cat = queryClient.getQueryData<{ nodes: NodeMeta[] }>(["nodes"]);
    const m = cat?.nodes.find((x) => x.type === n.type);
    outputCache.set(n.type, m ? m.outputs.map((o) => o.name) : []);
  }
  return outputCache.get(n.type);
}

export default function FlowEditorPage() {
  return <ReactFlowProvider><Editor /></ReactFlowProvider>;
}
