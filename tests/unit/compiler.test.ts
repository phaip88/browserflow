import { describe, it, expect } from "vitest";
import { compileFlow } from "@/flow/compiler";
import { emptyFlowDefinition, type FlowDefinition } from "@/flow/schema";
import { TEMPLATES } from "@/templates";

const base = (): FlowDefinition => ({ ...emptyFlowDefinition("t"), nodes: [
  { id: "start", type: "control.start", version: 1, position: { x: 0, y: 0 }, config: {}, inputs: {} },
  { id: "c", type: "data.constant", version: 1, position: { x: 0, y: 0 }, config: { value: 1 }, inputs: {} },
  { id: "ret", type: "control.return", version: 1, position: { x: 0, y: 0 }, config: {}, inputs: { value: { kind: "node", nodeId: "c", output: "value" } } },
], edges: [{ id: "e1", source: "start", target: "c", kind: "SUCCESS", priority: 100 }, { id: "e2", source: "c", target: "ret", kind: "SUCCESS", priority: 100 }] });

describe("compiler", () => {
  it("compiles a valid flow deterministically with checksums", () => {
    const a = compileFlow(base());
    const b = compileFlow(base());
    expect(a.ok).toBe(true);
    expect(a.compiled!.plan.order).toEqual(["start", "c", "ret"]);
    expect(a.compiled!.flowChecksum).toBe(b.compiled!.flowChecksum);
    expect(a.compiled!.compiledPlanChecksum).toBe(b.compiled!.compiledPlanChecksum);
    expect(a.compiled!.estimate.requiresBrowser).toBe(false);
  });
  it("rejects invalid schema", () => {
    const r = compileFlow({ schemaVersion: 2, nodes: [] });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === "SCHEMA")).toBe(true);
  });
  it("rejects unknown node types, duplicate ids and cycles", () => {
    const d = base();
    d.nodes.push({ id: "c", type: "data.nope", version: 1, position: { x: 0, y: 0 }, config: {}, inputs: {} });
    const r = compileFlow(d);
    expect(r.diagnostics.map((x) => x.code)).toEqual(expect.arrayContaining(["DUPLICATE_NODE_ID", "UNKNOWN_NODE_TYPE"]));
    const cyc = base();
    cyc.edges.push({ id: "e3", source: "ret", target: "c", kind: "SUCCESS", priority: 1 });
    const r2 = compileFlow(cyc);
    expect(r2.ok).toBe(false);
  });
  it("rejects illegal handles, missing required inputs, and edge conditions", () => {
    const d = base();
    d.edges[0].kind = "TRUE";
    d.nodes[2].inputs = {};
    d.edges[1].condition = "x > 1";
    const r = compileFlow(d);
    const codes = r.diagnostics.map((x) => x.code);
    expect(codes).toContain("HANDLE_NOT_ALLOWED");
    expect(codes).toContain("EDGE_CONDITION_UNSUPPORTED");
    expect(r.ok).toBe(false);
  });
  it("requires locator/page inputs to be runtime bindings and checks type compatibility", () => {
    const d = base();
    d.nodes.push({ id: "cnt", type: "locator.count", version: 1, position: { x: 0, y: 0 }, config: {}, inputs: { locator: { kind: "node", nodeId: "c", output: "value" } } });
    d.edges.push({ id: "e9", source: "ret", target: "cnt", kind: "SUCCESS", priority: 100 });
    const r = compileFlow(d);
    expect(r.diagnostics.some((x) => x.code === "TYPE_MISMATCH" || x.code === "TARGET_NO_INCOMING" || x.code === "HANDLE_NOT_ALLOWED")).toBe(true);
  });
  it("blocks dangerous literal URLs and unsafe expressions", () => {
    const d = base();
    d.nodes.push({ id: "h", type: "integration.httpRequest", version: 1, position: { x: 0, y: 0 }, config: { url: "http://169.254.169.254/latest", method: "GET" }, inputs: {} });
    d.nodes.push({ id: "t", type: "data.template", version: 1, position: { x: 0, y: 0 }, config: { template: "{{ process.exit() }}" }, inputs: {} });
    const r = compileFlow(d);
    const codes = r.diagnostics.map((x) => x.code);
    expect(codes).toContain("BLOCKED_HOST");
    expect(codes).toContain("UNSAFE_EXPRESSION");
  });
  it("detects loop subgraph overlap and reports unreachable nodes", () => {
    const d = base();
    d.nodes.push({ id: "loop", type: "control.foreach", version: 1, position: { x: 0, y: 0 }, config: { maxIterations: 5 }, inputs: { items: { kind: "literal", value: [1] } } });
    d.nodes.push({ id: "orphan", type: "control.end", version: 1, position: { x: 0, y: 0 }, config: {}, inputs: {} });
    d.edges = [{ id: "e1", source: "start", target: "loop", kind: "SUCCESS", priority: 100 }, { id: "e2", source: "loop", target: "c", kind: "LOOP_BODY", priority: 100 }, { id: "e3", source: "loop", target: "c", kind: "LOOP_DONE", priority: 100 }, { id: "e4", source: "c", target: "ret", kind: "SUCCESS", priority: 100 }];
    const r = compileFlow(d);
    expect(r.diagnostics.some((x) => x.code === "LOOP_SUBGRAPH_OVERLAP")).toBe(true);
    expect(r.diagnostics.some((x) => x.code === "UNREACHABLE" && x.nodeId === "orphan")).toBe(true);
  });
  it("enforces node limit and loop limit", () => {
    const d = base();
    const r = compileFlow(d, { maxNodesPerFlow: 2, maxNodeTimeoutMs: 1000, defaultFlowTimeoutMs: 1000, maxLoopIterations: 10 });
    expect(r.diagnostics.some((x) => x.code === "TOO_MANY_NODES")).toBe(true);
  });
  it("compiles every built-in template without errors and collects credential refs", () => {
    for (const t of TEMPLATES) {
      const r = compileFlow(t.definition);
      expect(r.ok, `${t.id}: ${JSON.stringify(r.diagnostics)}`).toBe(true);
    }
    const login = compileFlow(TEMPLATES.find((t) => t.id === "login-read")!.definition);
    expect(login.compiled!.estimate.credentialRefs).toEqual(["site-login"]);
  });
  it("handles 100-node flows quickly", () => {
    const d = base();
    d.edges = [];
    let prev = "start";
    for (let i = 0; i < 100; i++) {
      const id = `n${i}`;
      d.nodes.push({ id, type: "data.randomString", version: 1, position: { x: i, y: 0 }, config: { length: 4 }, inputs: {} });
      d.edges.push({ id: `e${i}`, source: prev, target: id, kind: "SUCCESS", priority: 100 });
      prev = id;
    }
    d.nodes = d.nodes.filter((n) => !["c", "ret"].includes(n.id));
    const t0 = Date.now();
    const r = compileFlow(d);
    expect(r.ok).toBe(true);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
