import path from "node:path";
import fs from "node:fs";
import type { Locator, Page } from "playwright";
import { config } from "@/core/config";
import { BFError, errors, randomToken } from "@/core/security";
import { logger, type Logger } from "@/core/logger";
import type { CompiledEdge, CompiledNode, ExecutionPlan } from "@/flow/compiler";
import type { EdgeKind } from "@/flow/schema";
import { NODE_IMPLEMENTATIONS } from "@/nodes/impl";
import { getNodeMeta } from "@/nodes/catalog";
import { Scope, renderTemplate, type CancellationToken, type NodeResult, type NodeRunContext } from "@/nodes/sdk";
import { BrowserSession, PLAYWRIGHT_VERSION } from "@/runtime/browser-session";
import { ArtifactService, SecretResolver, acquireIdentityLock, identityDirs, releaseIdentityLock, renewIdentityLock } from "@/runtime/services";
import { completeExecution, emitExecutionEvent, heartbeatLease, recordNodeFinish, recordNodeStart, workerTransition, type LeasedWork } from "./service";
import type { NodeStatus } from "./core";

class FlowStop extends Error {
  constructor(readonly kind: "return" | "fail" | "cancel" | "timeout" | "lease_lost", readonly value?: unknown, readonly code?: string) {
    super(kind);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, signal: AbortSignal, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new BFError("NODE", "TIMEOUT", `${label} timed out after ${ms}ms`)), ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new FlowStop("cancel"));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then((v) => resolve(v), reject).finally(() => {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
    });
  });
}

const isRuntimeValue = (v: unknown) => v !== null && typeof v === "object" && ("goto" in (v as object) || "click" in (v as object)) && !Array.isArray(v);
function describeForEvent(v: unknown): unknown {
  if (isRuntimeValue(v)) return "goto" in (v as object) ? "<page>" : "<locator>";
  return v === undefined ? null : v;
}

export async function runExecution(work: LeasedWork, hooks: { isDraining: () => boolean }): Promise<void> {
  const { lease, plan, execution } = work;
  const log: Logger = logger.child({ execution_id: lease.executionId, attempt_id: lease.attemptId, flow_id: execution.flowId, flow_version_id: execution.flowVersionId, worker_id: lease.workerId });
  const abort = new AbortController();
  let stopReason: FlowStop | null = null;
  const stop = (s: FlowStop) => {
    if (!stopReason) stopReason = s;
    abort.abort();
  };
  const cancellation: CancellationToken = {
    signal: abort.signal,
    get cancelled() {
      return abort.signal.aborted;
    },
    throwIfCancelled() {
      if (abort.signal.aborted) throw stopReason ?? new FlowStop("cancel");
    },
  };
  const runtimeDir = path.join(config.executionsRuntimeDir, lease.executionId);
  fs.mkdirSync(runtimeDir, { recursive: true });
  const artifacts = new ArtifactService(lease);
  const secrets = new SecretResolver();
  let browser: BrowserSession | null = null;
  const identityToken = randomToken(16);
  let identityLocked = false;
  const outputs = new Map<string, Record<string, unknown>>();
  const runtimeOutputs = new Map<string, Record<string, unknown>>();
  const visited = new Set<string>();
  const skipped = new Set<string>();
  let ordinal = 0;
  let stepCount = 0;
  let lastPreviewAt = 0;
  let previewInFlight = false;

  const started = Date.now();
  const flowTimeout = setTimeout(() => stop(new FlowStop("timeout")), execution.timeoutMs);

  const heartbeat = setInterval(async () => {
    try {
      const hb = await heartbeatLease(lease);
      if (!hb.ok) {
        log.error("lease lost; aborting execution", { error_code: "BF-WORKER-LEASE_LOST" });
        stop(new FlowStop("lease_lost"));
        return;
      }
      if (hb.cancelRequested) stop(new FlowStop("cancel"));
      if (execution.identityId && identityLocked) await renewIdentityLock(execution.identityId, lease.executionId, identityToken, config.worker.leaseTtlMs);
      if (hb.livePreview && browser && !previewInFlight && Date.now() - lastPreviewAt >= config.limits.livePreviewIntervalMs) {
        previewInFlight = true;
        lastPreviewAt = Date.now();
        try {
          const buf = await browser.screenshot();
          await artifacts.write({ kind: "screenshot", filename: "live-preview.jpg", data: buf, contentType: "image/jpeg" });
        } catch (e) {
          log.debug("live preview screenshot failed", { err: (e as Error).message });
        } finally {
          previewInFlight = false;
        }
      }
    } catch (e) {
      log.warn("heartbeat error", { err: (e as Error).message });
    }
  }, config.worker.heartbeatIntervalMs);

  const safeScreenshot = async (nodeId: string | undefined, name: string) => {
    if (!browser || browser.crashed || browser.pages.length === 0) return;
    try {
      const buf = await browser.screenshot();
      await artifacts.write({ nodeId, kind: "screenshot", filename: `${name}.jpg`, data: buf, contentType: "image/jpeg" });
    } catch (e) {
      log.debug("screenshot skipped", { err: (e as Error).message });
    }
  };

  const rootScope = new Scope("execution", null, "");
  for (const [k, v] of Object.entries(work.flowVersion.definition && (work.flowVersion.definition as { variables?: Record<string, unknown> }).variables ? (work.flowVersion.definition as { variables: Record<string, unknown> }).variables : {})) rootScope.set(k, v);
  rootScope.set("inputs", execution.inputs ?? {});
  rootScope.set("execution", { id: lease.executionId, attemptId: lease.attemptId });

  const sortedEdges = (node: CompiledNode, kind: EdgeKind): CompiledEdge[] => [...(node.out[kind] ?? [])].sort((a, b) => a.priority - b.priority || a.edgeId.localeCompare(b.edgeId));

  // -------- input & config resolution --------
  async function resolveInputs(node: CompiledNode, scope: Scope): Promise<{ inputs: Record<string, unknown>; secretKeys: Set<string>; configOut: Record<string, unknown> }> {
    const secretKeys = new Set<string>();
    const inputs: Record<string, unknown> = {};
    for (const [name, binding] of Object.entries(node.inputs)) {
      switch (binding.kind) {
        case "node": {
          const rt = runtimeOutputs.get(binding.nodeId)?.[binding.output];
          inputs[name] = rt !== undefined ? rt : outputs.get(binding.nodeId)?.[binding.output];
          break;
        }
        case "variable":
          inputs[name] = scope.get(binding.name);
          break;
        case "template": {
          if (secrets.isRef(binding.template)) {
            inputs[name] = (await secrets.resolve(binding.template)).value;
            secretKeys.add(name);
          } else inputs[name] = renderTemplate(binding.template, scope);
          break;
        }
        case "literal":
          inputs[name] = binding.value;
          break;
      }
    }
    const configOut: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node.config)) {
      if (typeof v === "string") {
        if (secrets.isRef(v)) {
          configOut[k] = (await secrets.resolve(v)).value;
          secretKeys.add(k);
        } else if (v.includes("{{")) {
          const rendered = renderTemplate(v, scope);
          if (secrets.isRef(rendered)) {
            configOut[k] = (await secrets.resolve(rendered as string)).value;
            secretKeys.add(k);
          } else configOut[k] = rendered;
        } else configOut[k] = v;
      } else configOut[k] = v;
    }
    for (const sf of node.sensitiveFields) if (configOut[sf] !== undefined && configOut[sf] !== null && configOut[sf] !== "") secretKeys.add(sf);
    return { inputs, secretKeys, configOut };
  }

  const eventSafe = (obj: Record<string, unknown>, secretKeys: Set<string>) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = secretKeys.has(k) ? "[SECRET]" : describeForEvent(v);
    return out;
  };

  // -------- single node run (with retry & timeout) --------
  async function executeNode(node: CompiledNode, scope: Scope): Promise<{ result: NodeResult | null; failed: boolean; error?: BFError }> {
    cancellation.throwIfCancelled();
    if (++stepCount > config.limits.maxNodeExecutions) throw new BFError("FLOW", "STEP_LIMIT", `Execution exceeded ${config.limits.maxNodeExecutions} node executions`);
    const impl = NODE_IMPLEMENTATIONS[node.type];
    const meta = getNodeMeta(node.type);
    if (!impl || !meta) throw new BFError("NODE", "NOT_IMPLEMENTED", `No implementation for ${node.type}`);
    visited.add(node.id);
    const myOrdinal = ordinal++;
    const { inputs, secretKeys, configOut } = await resolveInputs(node, scope);
    const startedAt = Date.now();
    const eventInput = { config: eventSafe(configOut, secretKeys), inputs: eventSafe(inputs, secretKeys) };
    let lastError: BFError | undefined;
    const maxAttempts = meta.supportsRetry ? Math.max(1, node.retry.maxAttempts) : 1;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      cancellation.throwIfCancelled();
      const started = await recordNodeStart(lease, { nodeId: node.id, nodeType: node.type, ordinal: myOrdinal, scopePath: scope.path, input: eventInput, retryCount: attempt });
      if (!started) throw new FlowStop("lease_lost");
      const ctx: NodeRunContext = {
        executionId: lease.executionId,
        attemptId: lease.attemptId,
        flowVersionId: execution.flowVersionId,
        nodeId: node.id,
        nodeType: node.type,
        config: configOut,
        inputs,
        secretKeys,
        scope,
        timeoutMs: node.timeoutMs,
        cancellation,
        artifacts,
        log: logger.child({ execution_id: lease.executionId, attempt_id: lease.attemptId, worker_id: lease.workerId, node_id: node.id }),
        browser: () => {
          if (!browser) throw errors.browser("NOT_AVAILABLE", "Browser session not available for this execution");
          if (browser.crashed) throw errors.browser("CRASHED", "Browser crashed");
          return browser;
        },
        page: () => {
          const p = inputs.page as Page | undefined;
          if (p && !p.isClosed()) return p;
          return ctx.browser().currentPage;
        },
        optionalLocator: (inputName = "locator") => {
          const l = inputs[inputName] as Locator | undefined;
          if (l && typeof (l as Locator).click === "function") return l;
          return null;
        },
        locator: (inputName = "locator") => {
          const l = ctx.optionalLocator(inputName);
          if (l) return l;
          if (meta.allowSelectorFallback && typeof configOut.selector === "string" && configOut.selector.trim()) return ctx.page().locator(configOut.selector.trim());
          throw errors.node("MISSING_LOCATOR", `${node.id} requires an upstream locator`);
        },
        notify: async (level, message, data) => {
          const okEmit = await emitExecutionEvent(lease, "notification", { nodeId: node.id, level, message, data: secretKeys.size ? "[omitted]" : (describeForEvent(data) ?? null) });
          if (!okEmit) throw new FlowStop("lease_lost");
        },
        registerPage: () => undefined,
      };
      try {
        const result = await withTimeout(impl(ctx), node.timeoutMs, abort.signal, node.id);
        const values = result.values ?? {};
        outputs.set(node.id, values);
        if (result.runtime) runtimeOutputs.set(node.id, result.runtime);
        if (node.outputVariable) {
          const single = Object.keys(values).length === 1 ? values[Object.keys(values)[0]] : values;
          scope.setFlow(node.outputVariable, single);
        }
        if (node.type === "page.goto" && plan.screenshotOnNavigation) await safeScreenshot(node.id, "after-navigation");
        const status: NodeStatus = result.control?.kind === "fail" ? "FAILED" : "SUCCEEDED";
        if (!(await recordNodeFinish(lease, { nodeId: node.id, nodeType: node.type, ordinal: myOrdinal, scopePath: scope.path, status, output: eventSafe(values, new Set()), durationMs: Date.now() - startedAt, retryCount: attempt, errorCode: status === "FAILED" ? "BF-FLOW-EXPLICIT_FAIL" : undefined, errorMessage: result.control?.kind === "fail" ? result.control.message : undefined }))) throw new FlowStop("lease_lost");
        return { result, failed: false };
      } catch (e) {
        if (abort.signal.aborted) cancellation.throwIfCancelled();
        if (e instanceof FlowStop) throw e;
        const bf = e instanceof BFError ? e : new BFError("NODE", "FAILED", (e as Error).message?.split("\n")[0] ?? "Node failed");
        lastError = bf;
        log.warn("node failed", { node_id: node.id, error_code: bf.code, err: bf.message, attempt });
        const retryable = attempt + 1 < maxAttempts && !bf.code.startsWith("BF-NETWORK") && !bf.code.startsWith("BF-CREDENTIAL") && !bf.code.startsWith("BF-FILE");
        if (retryable) {
          await new Promise((r) => setTimeout(r, node.retry.backoffMs));
          continue;
        }
        await safeScreenshot(node.id, "on-failure");
        const status: NodeStatus = bf.code === "BF-NODE-TIMEOUT" ? "TIMED_OUT" : "FAILED";
        if (!(await recordNodeFinish(lease, { nodeId: node.id, nodeType: node.type, ordinal: myOrdinal, scopePath: scope.path, status, errorCode: bf.code, errorMessage: bf.message, durationMs: Date.now() - startedAt, retryCount: attempt }))) throw new FlowStop("lease_lost");
        return { result: null, failed: true, error: bf };
      }
    }
    return { result: null, failed: true, error: lastError };
  }

  // -------- traversal --------
  async function runFrom(edges: CompiledEdge[], scope: Scope): Promise<void> {
    for (const edge of edges) {
      cancellation.throwIfCancelled();
      const node = plan.nodes[edge.target];
      if (!node) continue;
      await runNode(node, scope);
    }
  }

  async function runNode(node: CompiledNode, scope: Scope): Promise<void> {
    const { result, failed, error } = await executeNode(node, scope);
    if (failed) {
      const policy = node.errorPolicy;
      switch (policy.mode) {
        case "FOLLOW_ERROR_EDGE": {
          const errEdges = sortedEdges(node, "ERROR");
          if (errEdges.length === 0) throw error ?? new BFError("NODE", "FAILED", "Node failed");
          scope.set("error", { nodeId: node.id, code: error?.code, message: error?.message });
          for (const e of sortedEdges(node, "SUCCESS")) skipped.add(e.target);
          await runFrom(errEdges, scope);
          return;
        }
        case "CONTINUE":
          outputs.set(node.id, {});
          await runFrom(sortedEdges(node, "SUCCESS"), scope);
          return;
        case "USE_DEFAULT_VALUE": {
          const dv = policy.defaultValue;
          const values = dv && typeof dv === "object" && !Array.isArray(dv) ? (dv as Record<string, unknown>) : { value: dv ?? null };
          outputs.set(node.id, values);
          if (node.outputVariable) scope.setFlow(node.outputVariable, Object.keys(values).length === 1 ? values[Object.keys(values)[0]] : values);
          await runFrom(sortedEdges(node, "SUCCESS"), scope);
          return;
        }
        default:
          throw error ?? new BFError("NODE", "FAILED", "Node failed");
      }
    }
    const r = result!;
    if (r.control?.kind === "fail") throw new FlowStop("fail", r.control.message, "BF-FLOW-EXPLICIT_FAIL");
    if (r.control?.kind === "return") throw new FlowStop("return", r.control.value);
    if (node.type === "control.if") {
      const taken: EdgeKind = r.branch === "TRUE" ? "TRUE" : "FALSE";
      const other: EdgeKind = taken === "TRUE" ? "FALSE" : "TRUE";
      for (const e of sortedEdges(node, other)) skipped.add(e.target);
      const branchScope = new Scope("branch", scope, `${scope.path}/${node.id}:${taken}`);
      await runFrom(sortedEdges(node, taken), branchScope);
      return;
    }
    if (node.type === "control.foreach") {
      const loop = plan.loops[node.id];
      const items = r.loopItems ?? [];
      const results: unknown[] = [];
      for (let i = 0; i < items.length; i++) {
        cancellation.throwIfCancelled();
        const loopScope = Scope.loop(scope, items[i], i, items.length, node.id);
        await runFrom(loop ? loop.bodyEntry : sortedEdges(node, "LOOP_BODY"), loopScope);
        results.push(loopScope.get("result") ?? null);
      }
      outputs.set(node.id, { count: items.length, results });
      await runFrom(loop ? loop.doneTargets : sortedEdges(node, "LOOP_DONE"), scope);
      return;
    }
    await runFrom(sortedEdges(node, "SUCCESS"), scope);
  }

  // -------- lifecycle --------
  let finalStatus: "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT" = "SUCCEEDED";
  let output: unknown = null;
  let errorCode: string | undefined;
  let errorMessage: string | undefined;
  let leaseLost = false;
  try {
    if (!(await workerTransition(lease, ["LEASED"], "STARTING"))) throw new FlowStop("lease_lost");
    if (execution.identityId) {
      const locked = await acquireIdentityLock(execution.identityId, lease.executionId, identityToken, config.worker.leaseTtlMs);
      if (!locked) {
        log.info("identity busy; re-queueing execution");
        await workerTransition(lease, ["STARTING"], "QUEUED", { currentNodeId: null }, "identity locked by another execution");
        throw new FlowStop("lease_lost");
      }
      identityLocked = true;
    }
    const requiresBrowser = Object.values(plan.nodes).some((n) => n.requiredCapabilities.includes("browser"));
    if (requiresBrowser) {
      const profileDir = execution.identityId ? identityDirs(execution.identityId).profile : undefined;
      browser = await BrowserSession.launch({ executionId: lease.executionId, profileDir, runtimeDir, viewport: plan.viewport, log });
      await emitExecutionEvent(lease, "browser.started", { browserVersion: browser.browserVersion(), playwrightVersion: PLAYWRIGHT_VERSION, persistent: browser.persistent });
    }
    if (!(await workerTransition(lease, ["STARTING"], "RUNNING", { browserVersion: browser?.browserVersion() ?? null, playwrightVersion: PLAYWRIGHT_VERSION }))) throw new FlowStop("lease_lost");
    cancellation.throwIfCancelled();
    const entry = plan.nodes[plan.entryNodeId];
    try {
      await runNode(entry, rootScope);
    } catch (e) {
      if (e instanceof FlowStop && e.kind === "return") output = e.value ?? null;
      else throw e;
    }
  } catch (e) {
    if (e instanceof FlowStop) {
      if (e.kind === "lease_lost") leaseLost = true;
      else if (e.kind === "cancel") {
        finalStatus = "CANCELLED";
        errorCode = "BF-FLOW-CANCELLED";
        errorMessage = "Execution cancelled";
      } else if (e.kind === "timeout") {
        finalStatus = "TIMED_OUT";
        errorCode = "BF-FLOW-TIMEOUT";
        errorMessage = `Flow exceeded timeout of ${execution.timeoutMs}ms`;
      } else if (e.kind === "fail") {
        finalStatus = "FAILED";
        errorCode = e.code ?? "BF-FLOW-EXPLICIT_FAIL";
        errorMessage = String(e.value ?? "Flow failed");
      }
    } else {
      const bf = e instanceof BFError ? e : new BFError("SYSTEM", "UNEXPECTED", (e as Error).message ?? "Unexpected error");
      finalStatus = "FAILED";
      errorCode = bf.code;
      errorMessage = bf.message;
      log.error("execution failed", { error_code: bf.code, err: bf.message });
    }
  }

  // FINALLY subgraph (at most once), even after failure/cancel, but not after lease loss
  if (!leaseLost && plan.finallyTargets.length > 0) {
    try {
      const finallyController = new Scope("branch", rootScope, "/finally");
      finallyController.set("error", errorCode ? { code: errorCode, message: errorMessage } : null);
      finallyController.set("status", finalStatus);
      await runFrom(plan.finallyTargets, finallyController);
    } catch (e) {
      if (e instanceof FlowStop && e.kind === "lease_lost") leaseLost = true;
      else log.warn("finally subgraph failed", { err: (e as Error).message });
    }
  }

  clearTimeout(flowTimeout);
  clearInterval(heartbeat);
  if (!leaseLost) {
    if (finalStatus !== "CANCELLED") await safeScreenshot(undefined, "final");
    // Mark never-executed nodes
    let extra = ordinal;
    const unvisited: { nodeId: string; status: NodeStatus }[] = [];
    for (const id of plan.order) {
      if (visited.has(id)) continue;
      unvisited.push({ nodeId: id, status: skipped.has(id) ? "SKIPPED" : "NOT_REACHED" });
    }
    for (const u of unvisited) {
      const n = plan.nodes[u.nodeId];
      const okRec = await recordNodeFinish(lease, { nodeId: u.nodeId, nodeType: n.type, ordinal: extra++, scopePath: "", status: u.status, durationMs: 0, retryCount: 0 });
      if (!okRec) {
        leaseLost = true;
        break;
      }
    }
  }
  try {
    if (browser) {
      const blocked = browser.blocked.length;
      await browser.close();
      if (!leaseLost) await emitExecutionEvent(lease, "browser.closed", { blockedRequests: blocked, crashed: browser.crashed });
    }
  } catch (e) {
    log.warn("browser close error", { err: (e as Error).message });
  }
  try {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
  secrets.clear();
  if (!leaseLost) {
    const done = await completeExecution(lease, { status: finalStatus, output, errorCode, errorMessage, browserVersion: browser?.browserVersion() ?? null, playwrightVersion: PLAYWRIGHT_VERSION });
    if (!done) log.warn("completion rejected (stale lease or already terminal)");
  }
  if (execution.identityId && identityLocked) await releaseIdentityLock(execution.identityId, lease.executionId, identityToken);
  log.info("execution finished", { status: leaseLost ? "LEASE_LOST" : finalStatus, duration_ms: Date.now() - started, steps: stepCount, draining: hooks.isDraining() });
}
