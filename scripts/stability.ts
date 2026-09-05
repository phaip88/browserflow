import "dotenv/config";
process.env.BROWSERFLOW_LOG_LEVEL = process.env.BROWSERFLOW_LOG_LEVEL || "error";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { executionLeases, executions, flowVersions, flows } from "@/db/schema";
import { ensureDirectories } from "@/core/config";
import { checksumOf, newId } from "@/core/security";
import { compileFlow } from "@/flow/compiler";
import { getTemplate } from "@/templates";
import { acquireLease, completeExecution, createExecution, getExecutionSnapshot, recoverExpiredLeases, registerWorker, requestCancel, heartbeatLease } from "@/execution/service";
import { runExecution } from "@/execution/engine";
import { PLAYWRIGHT_VERSION, browserSelfCheck } from "@/runtime/browser-session";
import type { FlowDefinition } from "@/flow/schema";
import { execSync } from "node:child_process";

/** Stability & fault-injection scenarios producing machine-readable evidence. */
const CAPS = ["browser", "network", "filesystem"];
async function publish(def: FlowDefinition, name: string): Promise<string> {
  const c = compileFlow(def);
  if (!c.ok || !c.compiled) throw new Error(`compile failed: ${JSON.stringify(c.diagnostics)}`);
  const flowId = newId();
  await db.insert(flows).values({ id: flowId, name, draftDefinition: def, draftChecksum: checksumOf(def) });
  const [v] = await db.insert(flowVersions).values({ id: newId(), flowId, versionNumber: 1, definition: c.compiled.definition, compiledPlan: c.compiled.plan, flowChecksum: c.compiled.flowChecksum, compiledPlanChecksum: c.compiled.compiledPlanChecksum, nodeRegistryVersion: c.compiled.nodeRegistryVersion }).returning();
  await db.update(flows).set({ currentVersionId: v.id }).where(eq(flows.id, flowId));
  return flowId;
}
const chromiumCount = () => { try { return Number(execSync("pgrep -c -f '[h]eadless_shell|[c]hrome --headless' || true", { encoding: "utf8" }).trim() || 0); } catch { return 0; } };

async function main() {
  ensureDirectories();
  const workerId = `stability-${process.pid}`;
  const bs = await browserSelfCheck();
  await registerWorker({ workerId, hostname: "stability", pid: process.pid, capacity: 1, capabilities: CAPS, playwrightVersion: PLAYWRIGHT_VERSION, browserVersion: bs.version, browserHealthy: bs.ok });
  const results: Record<string, unknown> = { startedAt: new Date().toISOString() };
  const dataFlow = await publish(getTemplate("foreach-data")!.definition, "stab-data");
  const browserFlow = await publish(getTemplate("page-title-url")!.definition, "stab-browser");
  const waitDef: FlowDefinition = { ...getTemplate("foreach-data")!.definition, nodes: [{ id: "start", type: "control.start", version: 1, position: { x: 0, y: 0 }, config: {}, inputs: {} }, { id: "w", type: "control.wait", version: 1, position: { x: 0, y: 0 }, config: { ms: 20000 }, inputs: {} }], edges: [{ id: "e1", source: "start", target: "w", kind: "SUCCESS", priority: 100 }] };
  const waitFlow = await publish(waitDef, "stab-wait");
  const cleanupFlows = [dataFlow, browserFlow, waitFlow];

  // 1) 100 short executions (data) + 10 browser executions, sequential through the real engine
  const t0 = Date.now();
  let ok = 0;
  const N_SHORT = Number(process.env.STAB_SHORT ?? 100);
  const N_BROWSER = Number(process.env.STAB_BROWSER ?? 10);
  for (let i = 0; i < N_SHORT + N_BROWSER; i++) {
    const ex = await createExecution({ flowId: i < N_SHORT ? dataFlow : browserFlow, triggerType: "manual", actor: { kind: "system" } });
    const work = await acquireLease(workerId, CAPS);
    if (!work || work.execution.id !== ex.id) throw new Error("queue order violated");
    await runExecution(work, { isDraining: () => false });
    const snap = await getExecutionSnapshot(ex.id);
    if (snap.execution.status === "SUCCEEDED") ok++;
  }
  results.throughput = { shortRuns: N_SHORT, browserRuns: N_BROWSER, succeeded: ok, totalMs: Date.now() - t0, chromiumProcessesAfter: chromiumCount() };

  // 2) Cancellation while running: no browser residue, status CANCELLED
  {
    const ex = await createExecution({ flowId: waitFlow, triggerType: "manual", actor: { kind: "system" } });
    const work = (await acquireLease(workerId, CAPS))!;
    const runP = runExecution(work, { isDraining: () => false });
    await new Promise((r) => setTimeout(r, 1500));
    await requestCancel(ex.id, { kind: "user", id: "stab" });
    await runP;
    const snap = await getExecutionSnapshot(ex.id);
    results.cancellation = { status: snap.execution.status, ok: snap.execution.status === "CANCELLED", leaseReleased: snap.lease === null };
  }
  // 3) Worker lost: expire the lease, recover, then the stale worker must NOT be able to complete
  {
    const ex = await createExecution({ flowId: waitFlow, triggerType: "manual", actor: { kind: "system" } });
    const work = (await acquireLease(workerId, CAPS))!;
    await db.update(executionLeases).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(executionLeases.executionId, ex.id));
    const recovered = await recoverExpiredLeases({ kind: "system" });
    const staleHb = await heartbeatLease(work.lease);
    const staleComplete = await completeExecution(work.lease, { status: "SUCCEEDED", output: "stale" });
    const snap = await getExecutionSnapshot(ex.id);
    results.workerLost = { recovered, statusAfter: snap.execution.status, staleHeartbeatRejected: !staleHb.ok, staleCompletionRejected: !staleComplete, attemptStatus: snap.attempts[0]?.status, ok: !staleHb.ok && !staleComplete && snap.execution.status !== "SUCCEEDED" && snap.attempts[0]?.status === "WORKER_LOST" };
  }
  // 4) Flow timeout enforcement
  {
    const def = structuredClone(waitDef);
    def.settings = { ...def.settings, timeoutMs: 2000 };
    const f = await publish(def, "stab-timeout");
    cleanupFlows.push(f);
    const ex = await createExecution({ flowId: f, triggerType: "manual", actor: { kind: "system" } });
    const work = (await acquireLease(workerId, CAPS))!;
    await runExecution(work, { isDraining: () => false });
    const snap = await getExecutionSnapshot(ex.id);
    results.timeout = { status: snap.execution.status, ok: snap.execution.status === "TIMED_OUT" };
  }
  // 5) Event sequence integrity on a completed execution (gap-free, strictly increasing)
  {
    const ex = await createExecution({ flowId: dataFlow, triggerType: "manual", actor: { kind: "system" } });
    const work = (await acquireLease(workerId, CAPS))!;
    await runExecution(work, { isDraining: () => false });
    const rows = await db.execute<{ sequence: number }>(sql`select sequence from execution_events where execution_id = ${ex.id} order by sequence`);
    const seqs = rows.rows.map((r) => Number(r.sequence));
    const gapFree = seqs.every((s, i) => s === i + 1);
    const outbox = await db.execute<{ n: string }>(sql`select count(*)::text as n from outbox_events where execution_id = ${ex.id}`);
    results.events = { count: seqs.length, gapFree, outboxRows: Number(outbox.rows[0].n), ok: gapFree && Number(outbox.rows[0].n) === seqs.length };
  }
  results.chromiumProcessesAtEnd = chromiumCount();
  results.ok = [results.cancellation, results.workerLost, results.timeout, results.events].every((r) => (r as { ok: boolean }).ok) && ok === N_SHORT + N_BROWSER;
  results.finishedAt = new Date().toISOString();
  for (const f of cleanupFlows) await db.delete(flows).where(eq(flows.id, f));
  process.stdout.write(JSON.stringify(results, null, 2) + "\n");
  await pool.end();
  process.exit(results.ok ? 0 : 1);
}
main().catch(async (e) => { process.stderr.write(`stability failed: ${(e as Error).stack}\n`); await pool.end(); process.exit(1); });
