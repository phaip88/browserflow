import "dotenv/config";
process.env.BROWSERFLOW_SERVICE = process.env.BROWSERFLOW_SERVICE || "scheduler";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { Cron } from "croner";
import { db, pool } from "@/db";
import { artifacts, auditEvents, executionEvents, executions, outboxEvents, scheduleFires, schedules, userSessions, workers } from "@/db/schema";
import { config, ensureDirectories, validateConfig } from "@/core/config";
import { logger } from "@/core/logger";
import { newId } from "@/core/security";
import { createExecution, enforceExecutionTimeouts, recoverExpiredLeases, requestCancel } from "@/execution/service";
import { ACTIVE_STATUSES } from "@/execution/core";
import fs from "node:fs";
import path from "node:path";

/**
 * Scheduler process: persistent cron/one-shot schedules (PostgreSQL is the timer), misfire & overlap
 * policies, fire de-duplication (schedule_id + planned_fire_time), outbox publication (pg_notify),
 * lease recovery, flow timeout enforcement and retention cleanup.
 */
function nextRun(s: typeof schedules.$inferSelect, from: Date): Date | null {
  if (s.kind === "once") return null;
  if (!s.cronExpression) return null;
  return new Cron(s.cronExpression, { timezone: s.timezone }).nextRun(from);
}

async function fire(s: typeof schedules.$inferSelect, planned: Date, outcomeIfDup = "DUPLICATE"): Promise<string | null> {
  // De-duplication: unique (schedule_id, planned_fire_time)
  const inserted = await db.insert(scheduleFires).values({ id: newId(), scheduleId: s.id, plannedFireTime: planned, outcome: "PENDING" }).onConflictDoNothing().returning({ id: scheduleFires.id });
  if (inserted.length === 0) {
    logger.info("duplicate fire suppressed", { schedule_id: s.id, planned: planned.toISOString(), outcome: outcomeIfDup });
    return null;
  }
  const fireId = inserted[0].id;
  const active = await db.select({ id: executions.id }).from(executions).where(and(eq(executions.scheduleId, s.id), inArray(executions.status, ACTIVE_STATUSES))).limit(5);
  if (active.length > 0) {
    if (s.overlapPolicy === "SKIP") {
      await db.update(scheduleFires).set({ outcome: "SKIPPED_OVERLAP" }).where(eq(scheduleFires.id, fireId));
      return null;
    }
    if (s.overlapPolicy === "REPLACE") {
      for (const a of active) await requestCancel(a.id, { kind: "scheduler" }).catch(() => undefined);
    }
  }
  try {
    const ex = await createExecution({ flowId: s.flowId, triggerType: "schedule", scheduleId: s.id, identityId: s.identityId, inputs: s.inputs as Record<string, unknown>, actor: { kind: "scheduler" } });
    await db.update(scheduleFires).set({ outcome: "FIRED", executionId: ex.id }).where(eq(scheduleFires.id, fireId));
    return ex.id;
  } catch (e) {
    await db.update(scheduleFires).set({ outcome: `ERROR:${(e as Error).message.slice(0, 80)}` }).where(eq(scheduleFires.id, fireId));
    logger.error("schedule fire failed", { schedule_id: s.id, err: (e as Error).message });
    return null;
  }
}

async function tickSchedules(): Promise<void> {
  const due = await db.transaction(async (tx) => {
    const rows = await tx.execute<{ id: string }>(sql`SELECT id FROM schedules WHERE enabled = true AND next_fire_at IS NOT NULL AND next_fire_at <= now() ORDER BY next_fire_at FOR UPDATE SKIP LOCKED LIMIT 20`);
    return rows.rows.map((r) => r.id);
  });
  for (const id of due) {
    const [s] = await db.select().from(schedules).where(eq(schedules.id, id)).limit(1);
    if (!s || !s.enabled || !s.nextFireAt) continue;
    const now = new Date();
    const planned = s.nextFireAt;
    const lateMs = now.getTime() - planned.getTime();
    let lastExecutionId: string | null = null;
    if (lateMs > config.scheduler.misfireGraceMs) {
      if (s.misfirePolicy === "SKIP") {
        await db.insert(scheduleFires).values({ id: newId(), scheduleId: s.id, plannedFireTime: planned, outcome: "SKIPPED_MISFIRE" }).onConflictDoNothing();
      } else if (s.misfirePolicy === "RUN_ONCE") {
        lastExecutionId = await fire(s, planned);
      } else {
        let cursor: Date | null = planned;
        let n = 0;
        while (cursor && cursor.getTime() <= now.getTime() && n < config.scheduler.catchUpLimit) {
          lastExecutionId = (await fire(s, cursor)) ?? lastExecutionId;
          n++;
          cursor = nextRun(s, cursor);
        }
      }
    } else {
      lastExecutionId = await fire(s, planned);
    }
    // Advance strictly past `now` so a restart never re-fires the same planned time.
    const next = s.kind === "once" ? null : nextRun(s, new Date(Math.max(now.getTime(), planned.getTime())));
    const [upd] = await db
      .update(schedules)
      .set({ lastFireAt: now, nextFireAt: next, enabled: s.kind === "once" ? false : s.enabled, lastExecutionId: lastExecutionId ?? s.lastExecutionId, updatedAt: now, version: s.version + 1 })
      .where(and(eq(schedules.id, s.id), eq(schedules.version, s.version)))
      .returning({ id: schedules.id });
    if (!upd) logger.warn("schedule advanced concurrently", { schedule_id: s.id });
  }
}

/** Outbox publisher: at-least-once delivery to pg_notify listeners (SSE relays). */
async function publishOutbox(): Promise<number> {
  const rows = await db.select().from(outboxEvents).where(isNull(outboxEvents.publishedAt)).orderBy(outboxEvents.createdAt).limit(200);
  let published = 0;
  for (const r of rows) {
    try {
      await db.execute(sql`SELECT pg_notify('bf_events', ${`${r.executionId}:${r.eventId}`})`);
      await db.update(outboxEvents).set({ publishedAt: new Date(), attempts: r.attempts + 1 }).where(eq(outboxEvents.id, r.id));
      published++;
    } catch (e) {
      await db.update(outboxEvents).set({ attempts: r.attempts + 1 }).where(eq(outboxEvents.id, r.id));
      logger.warn("outbox publish failed", { err: (e as Error).message });
    }
  }
  return published;
}

export async function runCleanup(opts: { dryRun?: boolean; batch?: number } = {}): Promise<Record<string, number>> {
  const batch = opts.batch ?? 500;
  const cutoff = new Date(Date.now() - config.limits.retentionDays * 86400 * 1000);
  const result: Record<string, number> = {};
  const oldExecs = await db.select({ id: executions.id }).from(executions).where(and(lt(executions.createdAt, cutoff), inArray(executions.status, ["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"]))).limit(batch);
  result.executions = oldExecs.length;
  if (!opts.dryRun) {
    for (const e of oldExecs) {
      const arts = await db.select({ relativePath: artifacts.relativePath }).from(artifacts).where(eq(artifacts.executionId, e.id));
      for (const a of arts) fs.rmSync(path.join(config.artifactsDir, a.relativePath), { force: true });
      fs.rmSync(path.join(config.artifactsDir, e.id), { recursive: true, force: true });
      await db.delete(executions).where(eq(executions.id, e.id)); // cascades attempts/nodes/events/outbox/artifacts
    }
  }
  const pubOld = await db.select({ id: outboxEvents.id }).from(outboxEvents).where(lt(outboxEvents.publishedAt, new Date(Date.now() - 86400 * 1000))).limit(batch);
  result.outbox = pubOld.length;
  if (!opts.dryRun && pubOld.length) await db.delete(outboxEvents).where(inArray(outboxEvents.id, pubOld.map((p) => p.id)));
  const sess = await db.select({ id: userSessions.id }).from(userSessions).where(lt(userSessions.expiresAt, new Date())).limit(batch);
  result.sessions = sess.length;
  if (!opts.dryRun && sess.length) await db.delete(userSessions).where(inArray(userSessions.id, sess.map((s) => s.id)));
  const aud = await db.select({ id: auditEvents.id }).from(auditEvents).where(lt(auditEvents.createdAt, new Date(Date.now() - 4 * config.limits.retentionDays * 86400 * 1000))).limit(batch);
  result.audit = aud.length;
  if (!opts.dryRun && aud.length) await db.delete(auditEvents).where(inArray(auditEvents.id, aud.map((a) => a.id)));
  const deadWorkers = await db.select({ id: workers.id }).from(workers).where(and(inArray(workers.status, ["STOPPED", "LOST"]), lt(workers.lastHeartbeatAt, cutoff))).limit(batch);
  result.workers = deadWorkers.length;
  if (!opts.dryRun && deadWorkers.length) await db.delete(workers).where(inArray(workers.id, deadWorkers.map((w) => w.id)));
  const evOld = await db.select({ id: executionEvents.id }).from(executionEvents).where(lt(executionEvents.createdAt, cutoff)).limit(batch);
  result.events = evOld.length;
  if (!opts.dryRun && evOld.length) await db.delete(executionEvents).where(inArray(executionEvents.id, evOld.map((e) => e.id)));
  return result;
}

async function main(): Promise<void> {
  for (const f of validateConfig()) logger.warn(f.message);
  ensureDirectories();
  let stopping = false;
  let lastCleanup = 0;
  const stop = async () => {
    stopping = true;
    await pool.end().catch(() => undefined);
    logger.info("scheduler stopped");
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());
  logger.info("scheduler online", { poll_ms: config.scheduler.pollIntervalMs });
  while (!stopping) {
    const started = Date.now();
    try {
      await tickSchedules();
      await recoverExpiredLeases({ kind: "scheduler" });
      await enforceExecutionTimeouts();
      await publishOutbox();
      if (Date.now() - lastCleanup > 3600_000) {
        lastCleanup = Date.now();
        const r = await runCleanup();
        logger.info("cleanup finished", r);
      }
    } catch (e) {
      logger.error("scheduler tick failed (will retry)", { err: (e as Error).message });
    }
    const elapsed = Date.now() - started;
    await new Promise((r) => setTimeout(r, Math.max(250, config.scheduler.pollIntervalMs - elapsed)));
  }
}

if (require.main === module || process.argv[1]?.endsWith("scheduler/main.ts")) {
  main().catch((e) => {
    logger.error("scheduler fatal", { err: (e as Error).message });
    process.exit(1);
  });
}
