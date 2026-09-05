import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  artifacts, executionAttempts, executionEvents, executionLeases, executions, flowVersions, flows, identities, nodeExecutions, workers,
} from "@/db/schema";
import { errors, newId, randomToken } from "@/core/security";
import { config } from "@/core/config";
import { logger } from "@/core/logger";
import { appendEvent, isTerminal, transitionExecution, type Actor, type DbLike, type ExecutionStatus, type NodeStatus } from "./core";
import type { ExecutionPlan } from "@/flow/compiler";

export interface LeaseIdentity {
  executionId: string;
  attemptId: string;
  workerId: string;
  leaseToken: string;
}

export async function createExecution(params: {
  flowId: string;
  flowVersionId?: string;
  triggerType: "manual" | "schedule";
  scheduleId?: string;
  identityId?: string | null;
  inputs?: Record<string, unknown>;
  actor: Actor;
}): Promise<typeof executions.$inferSelect> {
  return db.transaction(async (tx) => {
    const [flow] = await tx.select().from(flows).where(eq(flows.id, params.flowId)).limit(1);
    if (!flow) throw errors.flow("NOT_FOUND", "Flow not found", 404);
    if (flow.archivedAt) throw errors.flow("ARCHIVED", "Flow is archived", 409);
    const versionId = params.flowVersionId ?? flow.currentVersionId;
    if (!versionId) throw errors.flow("NOT_PUBLISHED", "Flow has no published version", 409);
    const [fv] = await tx.select().from(flowVersions).where(and(eq(flowVersions.id, versionId), eq(flowVersions.flowId, flow.id))).limit(1);
    if (!fv) throw errors.flow("VERSION_NOT_FOUND", "Flow version not found", 404);
    const plan = fv.compiledPlan as ExecutionPlan;
    let identityId = params.identityId ?? null;
    if (!identityId && plan.identityRef) {
      const [ident] = await tx.select({ id: identities.id }).from(identities).where(eq(identities.id, plan.identityRef)).limit(1);
      if (!ident) throw errors.flow("IDENTITY_NOT_FOUND", `Identity ${plan.identityRef} referenced by flow does not exist`, 409);
      identityId = ident.id;
    }
    const id = newId();
    const now = new Date();
    const timeoutMs = Math.min(plan.flowTimeoutMs, config.limits.flowTimeoutMs);
    const [row] = await tx
      .insert(executions)
      .values({
        id,
        flowId: flow.id,
        flowVersionId: fv.id,
        flowChecksum: fv.flowChecksum,
        compiledPlanChecksum: fv.compiledPlanChecksum,
        nodeRegistryVersion: fv.nodeRegistryVersion,
        status: "CREATED",
        triggerType: params.triggerType,
        scheduleId: params.scheduleId ?? null,
        identityId,
        inputs: params.inputs ?? {},
        maxAttempts: plan.maxAttempts,
        timeoutMs,
        configSnapshot: {
          browserConcurrency: config.limits.browserConcurrency,
          nodeTimeoutMs: config.limits.nodeTimeoutMs,
          maxLoopIterations: config.limits.maxLoopIterations,
          maxPages: config.limits.maxPages,
          screenshotOnNavigation: plan.screenshotOnNavigation,
          privateAllowListEntries: config.network.privateAllowList.length,
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await appendEvent(tx, { executionId: id, type: "execution.created", payload: { triggerType: params.triggerType, actor: params.actor, flowVersion: fv.versionNumber } });
    await transitionExecution(tx, { executionId: id, from: ["CREATED"], to: "QUEUED", actor: params.actor, patch: { queuedAt: now } });
    const [fresh] = await tx.select().from(executions).where(eq(executions.id, id)).limit(1);
    return fresh ?? row;
  });
}

export async function requestCancel(executionId: string, actor: Actor): Promise<{ status: string }> {
  return db.transaction(async (tx) => {
    const [ex] = await tx.select().from(executions).where(eq(executions.id, executionId)).for("update").limit(1);
    if (!ex) throw errors.flow("EXECUTION_NOT_FOUND", "Execution not found", 404);
    const status = ex.status as ExecutionStatus;
    if (isTerminal(status)) return { status };
    if (status === "CANCELLING") return { status };
    const now = new Date();
    if (status === "QUEUED" || status === "CREATED" || status === "VALIDATING" || status === "WORKER_LOST") {
      await transitionExecution(tx, { executionId, from: [status], to: "CANCELLED", actor, reason: "cancelled before start", patch: { cancelRequestedAt: now, errorCode: "BF-FLOW-CANCELLED" } });
      await tx.delete(executionLeases).where(eq(executionLeases.executionId, executionId));
      return { status: "CANCELLED" };
    }
    await transitionExecution(tx, { executionId, from: [status], to: "CANCELLING", actor, reason: "cancel requested", patch: { cancelRequestedAt: now } });
    return { status: "CANCELLING" };
  });
}

// ---------------- Worker side ----------------

export async function registerWorker(params: { workerId: string; hostname: string; pid: number; capacity: number; capabilities: string[]; playwrightVersion: string; browserVersion: string | null; browserHealthy: boolean }): Promise<void> {
  await db
    .insert(workers)
    .values({ id: params.workerId, hostname: params.hostname, pid: params.pid, status: "ONLINE", capacity: params.capacity, capabilities: params.capabilities, playwrightVersion: params.playwrightVersion, browserVersion: params.browserVersion, browserHealthy: params.browserHealthy })
    .onConflictDoUpdate({ target: workers.id, set: { status: "ONLINE", lastHeartbeatAt: new Date(), browserVersion: params.browserVersion, browserHealthy: params.browserHealthy, stoppedAt: null } });
}
export async function workerHeartbeat(workerId: string, status: "ONLINE" | "DRAINING", browserHealthy: boolean): Promise<void> {
  await db.update(workers).set({ lastHeartbeatAt: new Date(), status, browserHealthy }).where(eq(workers.id, workerId));
}
export async function markWorkerStopped(workerId: string): Promise<void> {
  await db.update(workers).set({ status: "STOPPED", stoppedAt: new Date() }).where(eq(workers.id, workerId));
}

export interface LeasedWork {
  execution: typeof executions.$inferSelect;
  attempt: typeof executionAttempts.$inferSelect;
  lease: LeaseIdentity;
  plan: ExecutionPlan;
  flowVersion: typeof flowVersions.$inferSelect;
}

/** Atomically leases the oldest QUEUED execution using FOR UPDATE SKIP LOCKED. */
export async function acquireLease(workerId: string, capabilities: string[]): Promise<LeasedWork | null> {
  return db.transaction(async (tx) => {
    const picked = await tx.execute<{ id: string }>(sql`
      SELECT e.id FROM executions e
      WHERE e.status = 'QUEUED'
        AND (e.identity_id IS NULL OR NOT EXISTS (
          SELECT 1 FROM identities i WHERE i.id = e.identity_id AND i.locked_by_execution_id IS NOT NULL AND i.locked_by_execution_id <> e.id AND i.lock_expires_at > now()))
      ORDER BY e.queued_at ASC, e.created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1`);
    const row = picked.rows[0];
    if (!row) return null;
    const [ex] = await tx.select().from(executions).where(eq(executions.id, row.id)).limit(1);
    if (!ex) return null;
    const [fv] = await tx.select().from(flowVersions).where(eq(flowVersions.id, ex.flowVersionId)).limit(1);
    if (!fv) return null;
    const plan = fv.compiledPlan as ExecutionPlan;
    const requiredCaps = new Set<string>();
    for (const n of Object.values(plan.nodes)) n.requiredCapabilities.forEach((c) => requiredCaps.add(c));
    for (const c of requiredCaps) {
      if (!capabilities.includes(c)) {
        await transitionExecution(tx, { executionId: ex.id, from: ["QUEUED"], to: "FAILED", actor: { kind: "worker", id: workerId }, reason: `worker lacks capability ${c}`, patch: { errorCode: "BF-WORKER-CAPABILITY", errorMessage: `No worker capability: ${c}` } });
        return null;
      }
    }
    const attemptId = newId();
    const leaseToken = randomToken(24);
    const attemptNumber = ex.attemptCount + 1;
    const [attempt] = await tx.insert(executionAttempts).values({ id: attemptId, executionId: ex.id, attemptNumber, workerId, leaseToken, status: "LEASED", startedAt: new Date() }).returning();
    await tx.delete(executionLeases).where(eq(executionLeases.executionId, ex.id));
    await tx.insert(executionLeases).values({ executionId: ex.id, attemptId, workerId, leaseToken, expiresAt: sql`now() + make_interval(secs => ${config.worker.leaseTtlMs / 1000})` });
    const ok = await transitionExecution(tx, {
      executionId: ex.id,
      from: ["QUEUED"],
      to: "LEASED",
      actor: { kind: "worker", id: workerId },
      expectedVersion: ex.version,
      patch: { currentAttemptId: attemptId, attemptCount: attemptNumber, startedAt: ex.startedAt ?? new Date() },
      payload: { attemptNumber, workerId },
    });
    if (!ok) throw errors.worker("LEASE_RACE", "Lease lost during acquisition");
    const [fresh] = await tx.select().from(executions).where(eq(executions.id, ex.id)).limit(1);
    return { execution: fresh!, attempt, lease: { executionId: ex.id, attemptId, workerId, leaseToken }, plan, flowVersion: fv };
  });
}

function leaseGuard(lease: LeaseIdentity) {
  return and(
    eq(executionLeases.executionId, lease.executionId),
    eq(executionLeases.attemptId, lease.attemptId),
    eq(executionLeases.workerId, lease.workerId),
    eq(executionLeases.leaseToken, lease.leaseToken),
  );
}

/** Verifies the lease is still owned (same attempt, token, worker) and not expired by DB clock. */
export async function verifyLease(tx: DbLike, lease: LeaseIdentity): Promise<boolean> {
  const rows = await tx
    .select({ ok: sql<boolean>`${executionLeases.expiresAt} > now()`, current: executions.currentAttemptId, status: executions.status })
    .from(executionLeases)
    .innerJoin(executions, eq(executions.id, executionLeases.executionId))
    .where(leaseGuard(lease))
    .limit(1);
  const r = rows[0];
  return Boolean(r && r.ok && r.current === lease.attemptId && !isTerminal(r.status));
}

export async function heartbeatLease(lease: LeaseIdentity): Promise<{ ok: boolean; cancelRequested: boolean; livePreview: boolean }> {
  const [row] = await db
    .update(executionLeases)
    .set({ heartbeatAt: new Date(), expiresAt: sql`now() + make_interval(secs => ${config.worker.leaseTtlMs / 1000})` })
    .where(and(leaseGuard(lease), sql`${executionLeases.expiresAt} > now()`))
    .returning({ executionId: executionLeases.executionId });
  if (!row) return { ok: false, cancelRequested: false, livePreview: false };
  const [ex] = await db.select({ status: executions.status, livePreviewUntil: executions.livePreviewUntil, current: executions.currentAttemptId }).from(executions).where(eq(executions.id, lease.executionId)).limit(1);
  if (!ex || ex.current !== lease.attemptId || isTerminal(ex.status)) return { ok: false, cancelRequested: false, livePreview: false };
  return { ok: true, cancelRequested: ex.status === "CANCELLING", livePreview: !!ex.livePreviewUntil && ex.livePreviewUntil.getTime() > Date.now() };
}

/** Guarded transition performed by the owning worker. Returns false if the lease is stale. */
export async function workerTransition(lease: LeaseIdentity, from: ExecutionStatus[], to: ExecutionStatus, patch: Partial<typeof executions.$inferInsert> = {}, reason?: string, payload?: Record<string, unknown>): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await verifyLease(tx, lease))) return false;
    return transitionExecution(tx, { executionId: lease.executionId, from, to, actor: { kind: "worker", id: lease.workerId }, attemptId: lease.attemptId, patch, reason, payload });
  });
}

export async function emitExecutionEvent(lease: LeaseIdentity, type: string, payload: Record<string, unknown>): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await verifyLease(tx, lease))) return false;
    await appendEvent(tx, { executionId: lease.executionId, attemptId: lease.attemptId, type, payload });
    return true;
  });
}

export async function recordNodeStart(lease: LeaseIdentity, params: { nodeId: string; nodeType: string; ordinal: number; scopePath: string; input: unknown; retryCount: number }): Promise<string | null> {
  return db.transaction(async (tx) => {
    if (!(await verifyLease(tx, lease))) return null;
    const id = newId();
    const now = new Date();
    await tx
      .insert(nodeExecutions)
      .values({ id, executionId: lease.executionId, attemptId: lease.attemptId, nodeId: params.nodeId, nodeType: params.nodeType, ordinal: params.ordinal, scopePath: params.scopePath, status: "RUNNING", input: params.input as Record<string, unknown>, retryCount: params.retryCount, startedAt: now })
      .onConflictDoUpdate({ target: [nodeExecutions.attemptId, nodeExecutions.ordinal], set: { status: "RUNNING", retryCount: params.retryCount, startedAt: now } });
    await tx.update(executions).set({ currentNodeId: params.nodeId, updatedAt: now }).where(eq(executions.id, lease.executionId));
    await appendEvent(tx, { executionId: lease.executionId, attemptId: lease.attemptId, type: "node.started", payload: { nodeId: params.nodeId, nodeType: params.nodeType, ordinal: params.ordinal, scopePath: params.scopePath, retryCount: params.retryCount, input: params.input } });
    return id;
  });
}

export async function recordNodeFinish(lease: LeaseIdentity, params: { nodeId: string; nodeType: string; ordinal: number; scopePath: string; status: NodeStatus; output?: unknown; errorCode?: string; errorMessage?: string; durationMs: number; retryCount: number }): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await verifyLease(tx, lease))) return false;
    const now = new Date();
    const [existing] = await tx.select({ status: nodeExecutions.status }).from(nodeExecutions).where(and(eq(nodeExecutions.attemptId, lease.attemptId), eq(nodeExecutions.ordinal, params.ordinal))).limit(1);
    if (existing && existing.status !== "RUNNING" && existing.status !== "PENDING") return true; // idempotent completion
    await tx
      .insert(nodeExecutions)
      .values({ id: newId(), executionId: lease.executionId, attemptId: lease.attemptId, nodeId: params.nodeId, nodeType: params.nodeType, ordinal: params.ordinal, scopePath: params.scopePath, status: params.status, output: params.output as Record<string, unknown>, errorCode: params.errorCode, errorMessage: params.errorMessage, durationMs: params.durationMs, retryCount: params.retryCount, finishedAt: now })
      .onConflictDoUpdate({ target: [nodeExecutions.attemptId, nodeExecutions.ordinal], set: { status: params.status, output: params.output as Record<string, unknown>, errorCode: params.errorCode ?? null, errorMessage: params.errorMessage ?? null, durationMs: params.durationMs, retryCount: params.retryCount, finishedAt: now } });
    await appendEvent(tx, { executionId: lease.executionId, attemptId: lease.attemptId, type: "node.finished", payload: { nodeId: params.nodeId, nodeType: params.nodeType, ordinal: params.ordinal, scopePath: params.scopePath, status: params.status, output: params.output ?? null, errorCode: params.errorCode ?? null, errorMessage: params.errorMessage ?? null, durationMs: params.durationMs } });
    return true;
  });
}

export async function recordArtifact(lease: LeaseIdentity, params: { id: string; nodeId?: string; kind: string; filename: string; relativePath: string; contentType: string; sizeBytes: number; sha256: string }): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await verifyLease(tx, lease))) return false;
    await tx.insert(artifacts).values({ ...params, executionId: lease.executionId, attemptId: lease.attemptId, nodeId: params.nodeId ?? null }).onConflictDoNothing();
    await appendEvent(tx, { executionId: lease.executionId, attemptId: lease.attemptId, type: "artifact.created", payload: { artifactId: params.id, nodeId: params.nodeId ?? null, kind: params.kind, filename: params.filename, contentType: params.contentType, sizeBytes: params.sizeBytes } });
    return true;
  });
}

/** Idempotent, guarded completion: releases the lease and identity lock, and updates the attempt. */
export async function completeExecution(lease: LeaseIdentity, params: { status: "SUCCEEDED" | "FAILED" | "CANCELLED" | "TIMED_OUT"; output?: unknown; errorCode?: string; errorMessage?: string; browserVersion?: string | null; playwrightVersion?: string | null }): Promise<boolean> {
  return db.transaction(async (tx) => {
    if (!(await verifyLease(tx, lease))) return false;
    const [ex] = await tx.select().from(executions).where(eq(executions.id, lease.executionId)).for("update").limit(1);
    if (!ex || isTerminal(ex.status)) return false;
    const now = new Date();
    const ok = await transitionExecution(tx, {
      executionId: lease.executionId,
      from: ["LEASED", "STARTING", "RUNNING", "WAITING_FOR_INPUT", "CANCELLING"],
      to: params.status,
      actor: { kind: "worker", id: lease.workerId },
      attemptId: lease.attemptId,
      reason: params.errorMessage,
      patch: { output: params.output as Record<string, unknown> | undefined, errorCode: params.errorCode ?? null, errorMessage: params.errorMessage ?? null, currentNodeId: null, browserVersion: params.browserVersion ?? ex.browserVersion, playwrightVersion: params.playwrightVersion ?? ex.playwrightVersion, livePreviewUntil: null },
      payload: { errorCode: params.errorCode ?? null },
    });
    if (!ok) return false;
    await tx.update(executionAttempts).set({ status: params.status, finishedAt: now, errorCode: params.errorCode ?? null, errorMessage: params.errorMessage ?? null }).where(eq(executionAttempts.id, lease.attemptId));
    await tx.delete(executionLeases).where(leaseGuard(lease));
    await tx.update(identities).set({ lockedByExecutionId: null, lockToken: null, lockExpiresAt: null, lastUsedAt: now }).where(eq(identities.lockedByExecutionId, lease.executionId));
    // Mark nodes that never ran as NOT_REACHED for this attempt (informational rows are derived at read time)
    return true;
  });
}

/**
 * Recovers executions whose lease expired (worker crash / partition). Marks the attempt WORKER_LOST,
 * then re-queues (new attempt) or fails based on maxAttempts. Uses DB clock only.
 */
export async function recoverExpiredLeases(actor: Actor = { kind: "system" }): Promise<number> {
  const expired = await db.select().from(executionLeases).where(sql`${executionLeases.expiresAt} < now()`).limit(50);
  let recovered = 0;
  for (const lease of expired) {
    await db.transaction(async (tx) => {
      const [ex] = await tx.select().from(executions).where(eq(executions.id, lease.executionId)).for("update").limit(1);
      if (!ex || isTerminal(ex.status) || ex.currentAttemptId !== lease.attemptId) {
        await tx.delete(executionLeases).where(eq(executionLeases.executionId, lease.executionId));
        return;
      }
      const from = ex.status as ExecutionStatus;
      const now = new Date();
      await tx.update(executionAttempts).set({ status: "WORKER_LOST", finishedAt: now, errorCode: "BF-WORKER-LOST", errorMessage: "Worker lease expired" }).where(eq(executionAttempts.id, lease.attemptId));
      await tx.update(nodeExecutions).set({ status: "CANCELLED", finishedAt: now, errorCode: "BF-WORKER-LOST" }).where(and(eq(nodeExecutions.attemptId, lease.attemptId), eq(nodeExecutions.status, "RUNNING")));
      await tx.delete(executionLeases).where(eq(executionLeases.executionId, lease.executionId));
      await tx.update(identities).set({ lockedByExecutionId: null, lockToken: null, lockExpiresAt: null }).where(eq(identities.lockedByExecutionId, lease.executionId));
      if (from === "CANCELLING") {
        await transitionExecution(tx, { executionId: ex.id, from: [from], to: "CANCELLED", actor, reason: "worker lost while cancelling", patch: { errorCode: "BF-WORKER-LOST" } });
        return;
      }
      const ok = await transitionExecution(tx, { executionId: ex.id, from: [from], to: "WORKER_LOST", actor, reason: `lease expired for worker ${lease.workerId}`, payload: { workerId: lease.workerId, attemptId: lease.attemptId } });
      if (!ok) return;
      if (ex.attemptCount < ex.maxAttempts) {
        await transitionExecution(tx, { executionId: ex.id, from: ["WORKER_LOST"], to: "QUEUED", actor, reason: "retrying after worker loss", patch: { currentNodeId: null, queuedAt: now } });
      } else {
        await transitionExecution(tx, { executionId: ex.id, from: ["WORKER_LOST"], to: "FAILED", actor, reason: "max attempts reached after worker loss", patch: { errorCode: "BF-WORKER-LOST", errorMessage: "Worker lost and no attempts remaining" } });
      }
      recovered++;
    });
  }
  const staleWorkers = await db.update(workers).set({ status: "LOST" }).where(and(inArray(workers.status, ["ONLINE", "DRAINING"]), lt(workers.lastHeartbeatAt, new Date(Date.now() - config.worker.workerLostAfterMs)))).returning({ id: workers.id });
  if (staleWorkers.length) logger.warn("workers marked LOST", { count: staleWorkers.length });
  return recovered;
}

/** Flow-level timeout enforcement for executions whose worker is alive but the flow overran. */
export async function enforceExecutionTimeouts(): Promise<number> {
  const overdue = await db.select({ id: executions.id, status: executions.status }).from(executions).where(and(inArray(executions.status, ["LEASED", "STARTING", "RUNNING", "WAITING_FOR_INPUT"]), sql`${executions.startedAt} + make_interval(secs => ${executions.timeoutMs} / 1000.0) < now() - interval '30 seconds'`)).limit(50);
  let n = 0;
  for (const o of overdue) {
    await db.transaction(async (tx) => {
      const ok = await transitionExecution(tx, { executionId: o.id, from: [o.status as ExecutionStatus], to: "CANCELLING", actor: { kind: "system" }, reason: "flow timeout exceeded (enforced by recovery)", patch: { cancelRequestedAt: new Date(), errorCode: "BF-FLOW-TIMEOUT" } });
      if (ok) n++;
    });
  }
  return n;
}

// ---------------- Read side ----------------
export async function getExecutionSnapshot(executionId: string) {
  const [ex] = await db.select().from(executions).where(eq(executions.id, executionId)).limit(1);
  if (!ex) throw errors.flow("EXECUTION_NOT_FOUND", "Execution not found", 404);
  const [attempts, nodes, arts, fv, flow, lease] = await Promise.all([
    db.select().from(executionAttempts).where(eq(executionAttempts.executionId, executionId)).orderBy(asc(executionAttempts.attemptNumber)),
    db.select().from(nodeExecutions).where(eq(nodeExecutions.executionId, executionId)).orderBy(asc(nodeExecutions.attemptId), asc(nodeExecutions.ordinal)),
    db.select().from(artifacts).where(eq(artifacts.executionId, executionId)).orderBy(asc(artifacts.createdAt)),
    db.select({ id: flowVersions.id, versionNumber: flowVersions.versionNumber, definition: flowVersions.definition, compiledPlan: flowVersions.compiledPlan }).from(flowVersions).where(eq(flowVersions.id, ex.flowVersionId)).limit(1),
    db.select({ id: flows.id, name: flows.name }).from(flows).where(eq(flows.id, ex.flowId)).limit(1),
    db.select().from(executionLeases).where(eq(executionLeases.executionId, executionId)).limit(1),
  ]);
  return { execution: ex, attempts, nodes, artifacts: arts, flowVersion: fv[0] ?? null, flow: flow[0] ?? null, lease: lease[0] ?? null, lastSequence: ex.eventSequence };
}

export async function listEventsAfter(executionId: string, lastSequence: number, limit = 500) {
  return db
    .select()
    .from(executionEvents)
    .where(and(eq(executionEvents.executionId, executionId), gt(executionEvents.sequence, lastSequence)))
    .orderBy(asc(executionEvents.sequence))
    .limit(limit);
}

export async function listExecutions(params: { flowId?: string; status?: string; limit?: number; offset?: number }) {
  const conds = [];
  if (params.flowId) conds.push(eq(executions.flowId, params.flowId));
  if (params.status) conds.push(eq(executions.status, params.status));
  const rows = await db
    .select({ execution: executions, flowName: flows.name })
    .from(executions)
    .innerJoin(flows, eq(flows.id, executions.flowId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(executions.createdAt))
    .limit(Math.min(params.limit ?? 50, 200))
    .offset(params.offset ?? 0);
  return rows.map((r) => ({ ...r.execution, flowName: r.flowName }));
}

export async function requestLivePreview(executionId: string): Promise<void> {
  await db.update(executions).set({ livePreviewUntil: new Date(Date.now() + config.limits.livePreviewTtlMs) }).where(and(eq(executions.id, executionId), isNull(executions.finishedAt)));
}
