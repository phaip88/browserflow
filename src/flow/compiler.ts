import {
  CREDENTIAL_REF_RE,
  TEMPLATE_RE,
  fieldsToZod,
  flowDefinitionSchema,
  type EdgeKind,
  type ErrorPolicy,
  type FlowDefinition,
  type FlowEdge,
  type FlowNode,
  type InputBinding,
  type RetryPolicy,
} from "./schema";
import { NODE_REGISTRY_VERSION, getNodeMeta, type Capability, type NodeMeta } from "@/nodes/catalog";
import { checksumOf } from "@/core/security";
import { checkHostSync } from "@/core/network-policy";

export interface Diagnostic {
  severity: "ERROR" | "WARNING" | "INFO";
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
}
export interface CompiledEdge {
  edgeId: string;
  target: string;
  priority: number;
}
export interface CompiledNode {
  id: string;
  type: string;
  version: number;
  label: string;
  config: Record<string, unknown>;
  inputs: Record<string, InputBinding>;
  outputVariable?: string;
  timeoutMs: number;
  retry: RetryPolicy;
  errorPolicy: ErrorPolicy;
  out: Partial<Record<EdgeKind, CompiledEdge[]>>;
  requiredCapabilities: Capability[];
  sensitiveFields: string[];
}
export interface LoopPlan {
  loopNodeId: string;
  bodyEntry: CompiledEdge[];
  bodyNodes: string[];
  doneTargets: CompiledEdge[];
}
export interface ExecutionPlan {
  planVersion: 1;
  entryNodeId: string;
  nodes: Record<string, CompiledNode>;
  order: string[];
  loops: Record<string, LoopPlan>;
  finallyTargets: CompiledEdge[];
  flowTimeoutMs: number;
  maxAttempts: number;
  identityRef?: string;
  screenshotOnNavigation: boolean;
  viewport?: { width: number; height: number };
}
export interface ResourceEstimate {
  nodeCount: number;
  edgeCount: number;
  requiresBrowser: boolean;
  capabilities: Capability[];
  estimatedMaxSteps: number;
  maxLoopDepth: number;
  credentialRefs: string[];
  identityRef?: string;
}
export interface CompiledFlow {
  definition: FlowDefinition;
  plan: ExecutionPlan;
  estimate: ResourceEstimate;
  flowChecksum: string;
  compiledPlanChecksum: string;
  nodeRegistryVersion: string;
}
export interface CompileResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  compiled?: CompiledFlow;
}
export interface CompileLimits {
  maxNodesPerFlow: number;
  maxNodeTimeoutMs: number;
  defaultFlowTimeoutMs: number;
  maxLoopIterations: number;
}
export const DEFAULT_COMPILE_LIMITS: CompileLimits = {
  maxNodesPerFlow: 500,
  maxNodeTimeoutMs: 10 * 60 * 1000,
  defaultFlowTimeoutMs: 15 * 60 * 1000,
  maxLoopIterations: 1000,
};

const KIND_ORDER: EdgeKind[] = ["SUCCESS", "TRUE", "FALSE", "LOOP_BODY", "LOOP_DONE", "ERROR", "FINALLY"];
const LOOP_VARS = new Set(["item", "index", "length", "first", "last", "inputs", "error", "execution"]);

function sortEdges(edges: FlowEdge[]): FlowEdge[] {
  return [...edges].sort((a, b) => a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function extractCredentialRefs(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    const m = value.match(CREDENTIAL_REF_RE);
    if (m) acc.add(m[1]);
  } else if (Array.isArray(value)) value.forEach((v) => extractCredentialRefs(v, acc));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => extractCredentialRefs(v, acc));
  return acc;
}
function extractTemplateRoots(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    for (const m of value.matchAll(TEMPLATE_RE)) acc.add(m[1].split(/[.[]/)[0]);
  } else if (Array.isArray(value)) value.forEach((v) => extractTemplateRoots(v, acc));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((v) => extractTemplateRoots(v, acc));
  return acc;
}
function hasUnsafeTemplate(value: unknown): boolean {
  if (typeof value === "string") {
    // any `{{ ... }}` that is not a plain identifier path is rejected (no expression evaluation in v1)
    const all = value.match(/\{\{[\s\S]*?\}\}/g) ?? [];
    const safe = value.match(TEMPLATE_RE) ?? [];
    return all.length !== safe.length;
  }
  if (Array.isArray(value)) return value.some(hasUnsafeTemplate);
  if (value && typeof value === "object") return Object.values(value as Record<string, unknown>).some(hasUnsafeTemplate);
  return false;
}

export function compileFlow(rawDefinition: unknown, limits: CompileLimits = DEFAULT_COMPILE_LIMITS): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const err = (code: string, message: string, extra: Partial<Diagnostic> = {}) => diagnostics.push({ severity: "ERROR", code, message, ...extra });
  const warn = (code: string, message: string, extra: Partial<Diagnostic> = {}) => diagnostics.push({ severity: "WARNING", code, message, ...extra });

  const parsed = flowDefinitionSchema.safeParse(rawDefinition);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      err("SCHEMA", `${issue.path.join(".") || "root"}: ${issue.message}`);
    }
    return { ok: false, diagnostics };
  }
  const def = parsed.data;
  if (def.nodes.length > limits.maxNodesPerFlow) err("TOO_MANY_NODES", `Flow has ${def.nodes.length} nodes; limit is ${limits.maxNodesPerFlow}`);
  if (def.nodes.length === 0) err("EMPTY", "Flow has no nodes");

  // --- uniqueness
  const nodeById = new Map<string, FlowNode>();
  for (const n of def.nodes) {
    if (nodeById.has(n.id)) err("DUPLICATE_NODE_ID", `Duplicate node id ${n.id}`, { nodeId: n.id });
    nodeById.set(n.id, n);
  }
  const edgeIds = new Set<string>();
  const edgeSig = new Set<string>();
  for (const e of def.edges) {
    if (edgeIds.has(e.id)) err("DUPLICATE_EDGE_ID", `Duplicate edge id ${e.id}`, { edgeId: e.id });
    edgeIds.add(e.id);
    const sig = `${e.source}|${e.kind}|${e.target}`;
    if (edgeSig.has(sig)) warn("DUPLICATE_EDGE", `Duplicate ${e.kind} edge ${e.source} -> ${e.target}`, { edgeId: e.id });
    edgeSig.add(sig);
  }

  // --- node types, versions, config
  const metaById = new Map<string, NodeMeta>();
  const declaredVars = new Set<string>(Object.keys(def.variables));
  for (const n of def.nodes) if (n.outputVariable) declaredVars.add(n.outputVariable);
  for (const n of def.nodes) {
    const m = getNodeMeta(n.type);
    if (!m) {
      err("UNKNOWN_NODE_TYPE", `Unknown node type ${n.type}`, { nodeId: n.id });
      continue;
    }
    metaById.set(n.id, m);
    if (m.version !== n.version) err("NODE_VERSION_MISMATCH", `Node ${n.id} uses ${n.type}@${n.version}; registry has @${m.version}`, { nodeId: n.id });
    const cfgResult = fieldsToZod(m.fields).safeParse(n.config);
    if (!cfgResult.success) {
      for (const issue of cfgResult.error.issues) err("INVALID_CONFIG", `${n.id}.${issue.path.join(".")}: ${issue.message}`, { nodeId: n.id, field: String(issue.path[0] ?? "") });
    }
    if (hasUnsafeTemplate(n.config)) err("UNSAFE_EXPRESSION", `Node ${n.id} contains a template expression that is not a plain variable path`, { nodeId: n.id });
    for (const root of extractTemplateRoots(n.config)) {
      if (!declaredVars.has(root) && !LOOP_VARS.has(root)) warn("UNKNOWN_VARIABLE", `Node ${n.id} references undeclared variable {{${root}}}`, { nodeId: n.id });
    }
    if (n.timeoutMs !== undefined && n.timeoutMs > limits.maxNodeTimeoutMs) warn("TIMEOUT_CAPPED", `Node ${n.id} timeout capped to ${limits.maxNodeTimeoutMs}ms`, { nodeId: n.id });
    if (n.type === "control.foreach") {
      const mi = Number((n.config as { maxIterations?: unknown }).maxIterations ?? 100);
      if (mi > limits.maxLoopIterations) err("LOOP_LIMIT", `Node ${n.id} maxIterations ${mi} exceeds limit ${limits.maxLoopIterations}`, { nodeId: n.id });
    }
    if (n.type === "integration.httpRequest" || n.type === "page.goto") {
      const url = String((n.config as { url?: unknown }).url ?? "");
      if (url && !url.includes("{{")) {
        try {
          const u = new URL(url);
          if (!["http:", "https:"].includes(u.protocol)) err("DANGEROUS_URL", `Node ${n.id} uses unsupported scheme ${u.protocol}`, { nodeId: n.id });
          const d = checkHostSync(u.hostname);
          if (!d.allowed) err("BLOCKED_HOST", `Node ${n.id}: ${d.reason}`, { nodeId: n.id });
        } catch {
          err("INVALID_URL", `Node ${n.id} has an invalid URL`, { nodeId: n.id });
        }
      }
    }
    if (n.errorPolicy?.mode === "FOLLOW_ERROR_EDGE" && !def.edges.some((e) => e.source === n.id && e.kind === "ERROR")) {
      warn("MISSING_ERROR_EDGE", `Node ${n.id} follows ERROR edge but has none; failure will fail the flow`, { nodeId: n.id });
    }
    // input bindings
    for (const [inputName, binding] of Object.entries(n.inputs)) {
      const port = m.inputs.find((p) => p.name === inputName);
      if (!port) {
        err("UNKNOWN_INPUT", `Node ${n.id} binds unknown input ${inputName}`, { nodeId: n.id });
        continue;
      }
      if (binding.kind === "node") {
        const src = nodeById.get(binding.nodeId);
        const srcMeta = src ? getNodeMeta(src.type) : undefined;
        if (!src || !srcMeta) {
          err("INPUT_SOURCE_MISSING", `Node ${n.id}.${inputName} references missing node ${binding.nodeId}`, { nodeId: n.id });
          continue;
        }
        const outPort = srcMeta.outputs.find((o) => o.name === binding.output);
        if (!outPort) {
          err("INPUT_OUTPUT_MISSING", `Node ${n.id}.${inputName} references unknown output ${binding.nodeId}.${binding.output}`, { nodeId: n.id });
          continue;
        }
        const compatible = port.type === "any" || outPort.type === "any" || port.type === outPort.type || (port.type === "json" && !["page", "locator"].includes(outPort.type)) || (port.type === "string" && ["number", "boolean"].includes(outPort.type));
        if (!compatible) err("TYPE_MISMATCH", `Node ${n.id}.${inputName} expects ${port.type} but ${binding.nodeId}.${binding.output} is ${outPort.type}`, { nodeId: n.id });
      } else if (port.type === "page" || port.type === "locator") {
        err("RUNTIME_BINDING_REQUIRED", `Node ${n.id}.${inputName} must be bound to an upstream node output`, { nodeId: n.id });
      } else if (binding.kind === "variable" && !declaredVars.has(binding.name) && !LOOP_VARS.has(binding.name)) {
        warn("UNKNOWN_VARIABLE", `Node ${n.id}.${inputName} reads undeclared variable ${binding.name}`, { nodeId: n.id });
      } else if (binding.kind === "template" && hasUnsafeTemplate(binding.template)) {
        err("UNSAFE_EXPRESSION", `Node ${n.id}.${inputName} has an unsafe template expression`, { nodeId: n.id });
      }
    }
    for (const port of m.inputs) {
      if (!port.required) continue;
      const bound = n.inputs[port.name] !== undefined;
      const cfgFallback = n.config[port.name] !== undefined && n.config[port.name] !== "" && n.config[port.name] !== null;
      if (!bound && !cfgFallback) err("MISSING_REQUIRED_INPUT", `Node ${n.id} requires input ${port.name}`, { nodeId: n.id });
    }
    if (m.allowSelectorFallback) {
      const hasLocator = n.inputs.locator !== undefined;
      const selector = n.config.selector;
      if (!hasLocator && (typeof selector !== "string" || selector.trim() === "")) {
        err("MISSING_TARGET", `Node ${n.id} needs a locator input or a CSS selector`, { nodeId: n.id });
      }
    }
  }

  // --- edges
  for (const e of def.edges) {
    const src = nodeById.get(e.source);
    const tgt = nodeById.get(e.target);
    if (!src) err("EDGE_SOURCE_MISSING", `Edge ${e.id} source ${e.source} does not exist`, { edgeId: e.id });
    if (!tgt) err("EDGE_TARGET_MISSING", `Edge ${e.id} target ${e.target} does not exist`, { edgeId: e.id });
    if (!src || !tgt) continue;
    if (e.source === e.target) err("SELF_LOOP", `Edge ${e.id} is a self loop`, { edgeId: e.id });
    if (e.condition && e.condition.trim() !== "") err("EDGE_CONDITION_UNSUPPORTED", `Edge ${e.id}: edge conditions are not supported in schema v1; use control.if`, { edgeId: e.id });
    const sm = metaById.get(e.source);
    const tm = metaById.get(e.target);
    if (sm) {
      const allowed = e.kind === "ERROR" ? src.errorPolicy?.mode === "FOLLOW_ERROR_EDGE" && sm.type !== "control.start" : sm.sourceHandles.includes(e.kind);
      if (!allowed) err("HANDLE_NOT_ALLOWED", `Edge ${e.id}: ${src.type} cannot emit ${e.kind}${e.kind === "ERROR" ? " (set errorPolicy=FOLLOW_ERROR_EDGE)" : ""}`, { edgeId: e.id });
    }
    if (tm && !tm.acceptsIncoming) err("TARGET_NO_INCOMING", `Edge ${e.id}: ${tgt.type} cannot have incoming edges`, { edgeId: e.id });
  }

  // --- entry
  const starts = def.nodes.filter((n) => n.type === "control.start");
  if (starts.length !== 1) err("ENTRY", `Flow must have exactly one control.start (found ${starts.length})`);
  if (diagnostics.some((d) => d.severity === "ERROR")) return { ok: false, diagnostics };
  const entry = starts[0];

  // --- adjacency
  const outgoing = new Map<string, FlowEdge[]>();
  for (const e of def.edges) {
    const list = outgoing.get(e.source) ?? [];
    list.push(e);
    outgoing.set(e.source, list);
  }
  const outByKind = (id: string, kind: EdgeKind) => sortEdges((outgoing.get(id) ?? []).filter((e) => e.kind === kind));

  // --- cycle detection (all cycles illegal: loops are subgraphs)
  const color = new Map<string, number>();
  const cyclePath: string[] = [];
  const dfsCycle = (id: string): boolean => {
    color.set(id, 1);
    cyclePath.push(id);
    for (const e of outgoing.get(id) ?? []) {
      const c = color.get(e.target) ?? 0;
      if (c === 1) {
        err("CYCLE", `Cycle detected: ${[...cyclePath.slice(cyclePath.indexOf(e.target)), e.target].join(" -> ")}`, { edgeId: e.id });
        return true;
      }
      if (c === 0 && dfsCycle(e.target)) return true;
    }
    cyclePath.pop();
    color.set(id, 2);
    return false;
  };
  for (const n of def.nodes) if ((color.get(n.id) ?? 0) === 0 && dfsCycle(n.id)) break;
  if (diagnostics.some((d) => d.severity === "ERROR")) return { ok: false, diagnostics };

  // --- reachability & deterministic order
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    for (const kind of KIND_ORDER) for (const e of outByKind(id, kind)) visit(e.target);
  };
  visit(entry.id);
  for (const n of def.nodes) if (!seen.has(n.id)) warn("UNREACHABLE", `Node ${n.id} is unreachable and will be marked NOT_REACHED`, { nodeId: n.id });

  // --- loops
  const reach = (from: string[], stopAt: Set<string> = new Set()): Set<string> => {
    const s = new Set<string>();
    const stack = [...from];
    while (stack.length) {
      const id = stack.pop()!;
      if (s.has(id) || stopAt.has(id)) continue;
      s.add(id);
      for (const e of outgoing.get(id) ?? []) stack.push(e.target);
    }
    return s;
  };
  const loops: Record<string, LoopPlan> = {};
  const loopNodes = def.nodes.filter((n) => n.type === "control.foreach");
  for (const ln of loopNodes) {
    const bodyEntry = outByKind(ln.id, "LOOP_BODY");
    const done = outByKind(ln.id, "LOOP_DONE");
    if (bodyEntry.length === 0) warn("EMPTY_LOOP_BODY", `Loop ${ln.id} has no LOOP_BODY edge`, { nodeId: ln.id });
    const bodyNodes = reach(bodyEntry.map((e) => e.target));
    const doneNodes = reach(done.map((e) => e.target));
    for (const id of bodyNodes) if (doneNodes.has(id)) err("LOOP_SUBGRAPH_OVERLAP", `Node ${id} is reachable from both LOOP_BODY and LOOP_DONE of ${ln.id}`, { nodeId: id });
    loops[ln.id] = {
      loopNodeId: ln.id,
      bodyEntry: bodyEntry.map((e) => ({ edgeId: e.id, target: e.target, priority: e.priority })),
      bodyNodes: [...bodyNodes].sort(),
      doneTargets: done.map((e) => ({ edgeId: e.id, target: e.target, priority: e.priority })),
    };
  }
  let maxLoopDepth = 0;
  for (const a of loopNodes) {
    let depth = 1;
    let cur = a.id;
    for (let guard = 0; guard < 50; guard++) {
      const parent = loopNodes.find((b) => b.id !== cur && loops[b.id].bodyNodes.includes(cur));
      if (!parent) break;
      depth++;
      cur = parent.id;
    }
    maxLoopDepth = Math.max(maxLoopDepth, depth);
  }
  for (const n of def.nodes) {
    if (n.type === "control.if" && outByKind(n.id, "TRUE").length + outByKind(n.id, "FALSE").length === 0) warn("IF_WITHOUT_BRANCH", `If node ${n.id} has no TRUE/FALSE edges`, { nodeId: n.id });
  }
  const finallyEdges = outByKind(entry.id, "FINALLY");
  if (diagnostics.some((d) => d.severity === "ERROR")) return { ok: false, diagnostics };

  // --- compiled nodes
  const nodes: Record<string, CompiledNode> = {};
  const caps = new Set<Capability>();
  const credentialRefs = new Set<string>();
  for (const n of def.nodes) {
    const m = metaById.get(n.id)!;
    m.requiredCapabilities.forEach((c) => caps.add(c));
    extractCredentialRefs(n.config, credentialRefs);
    extractCredentialRefs(n.inputs, credentialRefs);
    const out: Partial<Record<EdgeKind, CompiledEdge[]>> = {};
    for (const kind of KIND_ORDER) {
      const list = outByKind(n.id, kind);
      if (list.length) out[kind] = list.map((e) => ({ edgeId: e.id, target: e.target, priority: e.priority }));
    }
    nodes[n.id] = {
      id: n.id,
      type: n.type,
      version: n.version,
      label: n.label ?? m.displayName,
      config: n.config,
      inputs: n.inputs,
      outputVariable: n.outputVariable,
      timeoutMs: Math.min(n.timeoutMs ?? m.defaultTimeoutMs, limits.maxNodeTimeoutMs),
      retry: n.retry ?? m.defaultRetryPolicy ?? { maxAttempts: 1, backoffMs: 0 },
      errorPolicy: n.errorPolicy ?? { mode: "FAIL_FLOW" },
      out,
      requiredCapabilities: m.requiredCapabilities,
      sensitiveFields: m.sensitiveFields,
    };
  }
  const identityRef = def.settings.identityRef;
  const plan: ExecutionPlan = {
    planVersion: 1,
    entryNodeId: entry.id,
    nodes,
    order,
    loops,
    finallyTargets: finallyEdges.map((e) => ({ edgeId: e.id, target: e.target, priority: e.priority })),
    flowTimeoutMs: def.settings.timeoutMs ?? limits.defaultFlowTimeoutMs,
    maxAttempts: def.settings.maxAttempts,
    identityRef,
    screenshotOnNavigation: def.settings.screenshotOnNavigation,
    viewport: def.settings.viewport,
  };
  let estimatedMaxSteps = def.nodes.length;
  for (const l of Object.values(loops)) {
    const mi = Number((nodeById.get(l.loopNodeId)!.config as { maxIterations?: unknown }).maxIterations ?? 100);
    estimatedMaxSteps += l.bodyNodes.length * mi;
  }
  const estimate: ResourceEstimate = {
    nodeCount: def.nodes.length,
    edgeCount: def.edges.length,
    requiresBrowser: caps.has("browser"),
    capabilities: [...caps].sort(),
    estimatedMaxSteps,
    maxLoopDepth,
    credentialRefs: [...credentialRefs].sort(),
    identityRef,
  };
  const compiled: CompiledFlow = {
    definition: def,
    plan,
    estimate,
    flowChecksum: checksumOf(def),
    compiledPlanChecksum: checksumOf(plan),
    nodeRegistryVersion: NODE_REGISTRY_VERSION,
  };
  return { ok: true, diagnostics, compiled };
}

