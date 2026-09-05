import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { executionEvents, executions, outboxEvents } from "@/db/schema";
import { errors, newId } from "@/core/security";
import { scrubKnownSecrets, redact } from "@/core/logger";

export const EXECUTION_STATUSES = [
  "CREATED", "VALIDATING", "QUEUED", "LEASED", "STARTING", "RUNNING", "WAITING_FOR_INPUT",
  "CANCELLING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT", "WORKER_LOST",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];
export const TERMINAL_STATUSES: ReadonlySet<ExecutionStatus> = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]);
export const ACTIVE_STATUSES: ExecutionStatus[] = ["QUEUED", "LEASED", "STARTING", "RUNNING", "WAITING_FOR_INPUT", "CANCELLING"];

const TRANSITIONS: Record<ExecutionStatus, ExecutionStatus[]> = {
  CREATED: ["VALIDATING", "QUEUED", "FAILED", "CANCELLED"],
  VALIDATING: ["QUEUED", "FAILED", "CANCELLED"],
  QUEUED: ["LEASED", "CANCELLED", "TIMED_OUT", "FAILED"],
  LEASED: ["STARTING", "RUNNING", "QUEUED", "WORKER_LOST", "CANCELLING", "CANCELLED", "FAILED", "TIMED_OUT"],
  STARTING: ["RUNNING", "WORKER_LOST", "CANCELLING", "CANCELLED", "FAILED", "TIMED_OUT"],
  RUNNING: ["WAITING_FOR_INPUT", "CANCELLING", "SUCCEEDED", "FAILED", "TIMED_OUT", "WORKER_LOST", "CANCELLED"],
  WAITING_FOR_INPUT: ["RUNNING", "CANCELLING", "TIMED_OUT", "WORKER_LOST", "CANCELLED"],
  CANCELLING: ["CANCELLED", "SUCCEEDED", "FAILED", "TIMED_OUT", "WORKER_LOST"],
  WORKER_LOST: ["QUEUED", "FAILED", "CANCELLED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  TIMED_OUT: [],
};

export function canTransition(from: ExecutionStatus, to: ExecutionStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
export function assertTransition(from: ExecutionStatus, to: ExecutionStatus): void {
  if (!canTransition(from, to)) throw errors.flow("INVALID_TRANSITION", `Illegal execution transition ${from} -> ${to}`, 409);
}
export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.has(status as ExecutionStatus);
}

export const NODE_STATUSES = ["PENDING", "RUNNING", "SUCCEEDED", "FAILED", "SKIPPED", "NOT_REACHED", "CANCELLED", "TIMED_OUT"] as const;
export type NodeStatus = (typeof NODE_STATUSES)[number];

export type Actor = { kind: "user"; id: string } | { kind: "worker"; id: string } | { kind: "scheduler" } | { kind: "system" };

export interface EventEnvelope<T = Record<string, unknown>> {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  timestamp: string;
  executionId: string;
  flowId: string;
  flowVersionId: string;
  attemptId: string | null;
  traceId: string | null;
  type: string;
  payload: T;
}

// Drizzle transaction type helper
export type Tx = Parameters<Parameters<NodePgDatabase["transaction"]>[0]>[0];
export type DbLike = NodePgDatabase | Tx;

/**
 * Appends an ExecutionEvent within the caller's transaction. The sequence is allocated
 * atomically by incrementing executions.event_sequence under row lock, and an OutboxEvent
 * is created in the same transaction (at-least-once publication downstream).
 */
export async function appendEvent(
  tx: DbLike,
  params: { executionId: string; attemptId?: string | null; type: string; payload: Record<string, unknown>; traceId?: string | null },
): Promise<EventEnvelope> {
  const [row] = await tx
    .update(executions)
    .set({ eventSequence: sql`${executions.eventSequence} + 1`, updatedAt: new Date() })
    .where(eq(executions.id, params.executionId))
    .returning({ sequence: executions.eventSequence, flowId: executions.flowId, flowVersionId: executions.flowVersionId });
  if (!row) throw errors.flow("EXECUTION_NOT_FOUND", `Execution ${params.executionId} not found`, 404);
  const eventId = newId();
  const safePayload = scrubKnownSecrets(redact(params.payload));
  const createdAt = new Date();
  await tx.insert(executionEvents).values({
    id: eventId,
    executionId: params.executionId,
    attemptId: params.attemptId ?? null,
    sequence: row.sequence,
    type: params.type,
    payload: safePayload,
    traceId: params.traceId ?? null,
    createdAt,
  });
  await tx.insert(outboxEvents).values({ id: newId(), eventId, executionId: params.executionId });
  return {
    schemaVersion: 1,
    eventId,
    sequence: row.sequence,
    timestamp: createdAt.toISOString(),
    executionId: params.executionId,
    flowId: row.flowId,
    flowVersionId: row.flowVersionId,
    attemptId: params.attemptId ?? null,
    traceId: params.traceId ?? null,
    type: params.type,
    payload: safePayload,
  };
}

/**
 * Guarded status transition. Only succeeds when the row currently has `from` status and
 * (optionally) matches the expected version / attempt / lease. Returns false when the guard fails.
 */
export async function transitionExecution(
  tx: DbLike,
  params: {
    executionId: string;
    from: ExecutionStatus[];
    to: ExecutionStatus;
    actor: Actor;
    reason?: string;
    attemptId?: string | null;
    expectedVersion?: number;
    patch?: Partial<typeof executions.$inferInsert>;
    payload?: Record<string, unknown>;
  },
): Promise<boolean> {
  const allowedFrom = params.from.filter((f) => canTransition(f, params.to));
  if (allowedFrom.length === 0) assertTransition(params.from[0], params.to);
  const now = new Date();
  const conditions = [eq(executions.id, params.executionId), inArray(executions.status, allowedFrom)];
  if (params.expectedVersion !== undefined) conditions.push(eq(executions.version, params.expectedVersion));
  if (params.attemptId) conditions.push(eq(executions.currentAttemptId, params.attemptId));
  const finishedAt = isTerminal(params.to) ? now : undefined;
  const [updated] = await tx
    .update(executions)
    .set({ status: params.to, version: sql`${executions.version} + 1`, updatedAt: now, ...(finishedAt ? { finishedAt } : {}), ...(params.patch ?? {}) })
    .where(and(...conditions))
    .returning({ id: executions.id, status: executions.status });
  if (!updated) return false;
  await appendEvent(tx, {
    executionId: params.executionId,
    attemptId: params.attemptId ?? null,
    type: "execution.status",
    payload: { status: params.to, reason: params.reason ?? null, actor: params.actor, at: now.toISOString(), ...(params.payload ?? {}) },
  });
  return true;
}
