import fs from "node:fs";
import { z } from "zod";
import { Cron } from "croner";
import { and, count, desc, eq, sql, sum } from "drizzle-orm";
import { Registry, Gauge, collectDefaultMetrics } from "prom-client";
import { db } from "@/db";
import { appSettings, artifacts, credentials, executions, identities, scheduleFires, schedules, workers } from "@/db/schema";
import { json, route } from "./http";
import { config, validateConfig } from "@/core/config";
import { errors, newId } from "@/core/security";
import { createCredential, updateCredential, identityDirs } from "@/runtime/services";
import { createExecution } from "@/execution/service";
import { audit } from "@/auth/service";
import { AI_TOOL_SCHEMAS, getAIProvider } from "@/ai/provider";
const PLAYWRIGHT_VERSION = "1.52.0";
import { NODE_REGISTRY_VERSION } from "@/nodes/catalog";

// ---------------- schedules ----------------
const scheduleBody = z.object({
  flowId: z.string(),
  name: z.string().min(1).max(120),
  kind: z.enum(["cron", "once"]),
  cronExpression: z.string().max(100).optional(),
  runAt: z.string().datetime().optional(),
  timezone: z.string().max(64).default("UTC"),
  enabled: z.boolean().default(true),
  misfirePolicy: z.enum(["SKIP", "RUN_ONCE", "CATCH_UP_LIMITED"]).default("RUN_ONCE"),
  overlapPolicy: z.enum(["SKIP", "QUEUE", "REPLACE"]).default("SKIP"),
  identityId: z.string().nullable().optional(),
  inputs: z.record(z.string(), z.unknown()).default({}),
});

export function computeNextFire(s: { kind: string; cronExpression: string | null; runAt: Date | null; timezone: string }, from: Date): Date | null {
  if (s.kind === "once") return s.runAt && s.runAt.getTime() > from.getTime() ? s.runAt : null;
  if (!s.cronExpression) return null;
  try {
    const c = new Cron(s.cronExpression, { timezone: s.timezone });
    return c.nextRun(from);
  } catch {
    throw errors.scheduler("INVALID_CRON", "Invalid cron expression or timezone");
  }
}
function validateTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw errors.scheduler("INVALID_TIMEZONE", `Unknown timezone ${tz}`);
  }
}

route("GET", "/schedules", async () => json({ schedules: await db.select().from(schedules).orderBy(desc(schedules.createdAt)) }));
route("POST", "/schedules", async (ctx) => {
  const b = await ctx.body(scheduleBody);
  validateTimezone(b.timezone);
  if (b.kind === "cron" && !b.cronExpression) throw errors.scheduler("CRON_REQUIRED", "cronExpression required for cron schedules");
  if (b.kind === "once" && !b.runAt) throw errors.scheduler("RUNAT_REQUIRED", "runAt required for one-shot schedules");
  const runAt = b.runAt ? new Date(b.runAt) : null;
  const nextFireAt = computeNextFire({ kind: b.kind, cronExpression: b.cronExpression ?? null, runAt, timezone: b.timezone }, new Date());
  if (!nextFireAt && b.enabled) throw errors.scheduler("NO_NEXT_RUN", "Schedule would never fire");
  const [row] = await db.insert(schedules).values({ id: newId(), flowId: b.flowId, name: b.name, kind: b.kind, cronExpression: b.cronExpression ?? null, runAt, timezone: b.timezone, enabled: b.enabled, misfirePolicy: b.misfirePolicy, overlapPolicy: b.overlapPolicy, identityId: b.identityId ?? null, inputs: b.inputs, nextFireAt: b.enabled ? nextFireAt : null }).returning();
  await audit("schedule.create", "success", { userId: ctx.session!.user.id, target: row.id });
  return json({ schedule: row }, 201);
});
route("PUT", "/schedules/:id", async (ctx) => {
  const b = await ctx.body(scheduleBody.partial());
  const [s] = await db.select().from(schedules).where(eq(schedules.id, ctx.params.id)).limit(1);
  if (!s) throw errors.scheduler("NOT_FOUND", "Schedule not found", 404);
  const merged = { ...s, ...b, runAt: b.runAt ? new Date(b.runAt) : s.runAt, cronExpression: b.cronExpression ?? s.cronExpression, identityId: b.identityId === undefined ? s.identityId : b.identityId };
  validateTimezone(merged.timezone);
  const nextFireAt = merged.enabled ? computeNextFire(merged, new Date()) : null;
  const [row] = await db.update(schedules).set({ ...merged, id: s.id, nextFireAt, updatedAt: new Date(), version: s.version + 1, inputs: merged.inputs as Record<string, unknown> }).where(and(eq(schedules.id, s.id), eq(schedules.version, s.version))).returning();
  if (!row) throw errors.scheduler("CONFLICT", "Schedule modified concurrently", 409);
  return json({ schedule: row });
});
route("DELETE", "/schedules/:id", async (ctx) => {
  await db.delete(schedules).where(eq(schedules.id, ctx.params.id));
  return json({ ok: true });
});
route("GET", "/schedules/:id/fires", async ({ params }) => json({ fires: await db.select().from(scheduleFires).where(eq(scheduleFires.scheduleId, params.id)).orderBy(desc(scheduleFires.plannedFireTime)).limit(50) }));
route("POST", "/schedules/:id/run-now", async (ctx) => {
  const [s] = await db.select().from(schedules).where(eq(schedules.id, ctx.params.id)).limit(1);
  if (!s) throw errors.scheduler("NOT_FOUND", "Schedule not found", 404);
  const ex = await createExecution({ flowId: s.flowId, triggerType: "schedule", scheduleId: s.id, identityId: s.identityId, inputs: s.inputs as Record<string, unknown>, actor: { kind: "user", id: ctx.session!.user.id } });
  await db.insert(scheduleFires).values({ id: newId(), scheduleId: s.id, plannedFireTime: new Date(), executionId: ex.id, outcome: "MANUAL" }).onConflictDoNothing();
  return json({ execution: ex }, 201);
});

// ---------------- credentials ----------------
const credCols = { id: credentials.id, name: credentials.name, kind: credentials.kind, fieldNames: credentials.fieldNames, createdAt: credentials.createdAt, updatedAt: credentials.updatedAt };
route("GET", "/credentials", async () => json({ credentials: await db.select(credCols).from(credentials).orderBy(desc(credentials.createdAt)) }));
route("POST", "/credentials", async (ctx) => {
  const b = await ctx.body(z.object({ name: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/, "Use letters, digits, dash, underscore"), kind: z.enum(["password", "token", "custom"]).default("custom"), fields: z.record(z.string(), z.string().max(4096)) }));
  const row = await createCredential(b);
  await audit("credential.create", "success", { userId: ctx.session!.user.id, target: row.id });
  return json({ credential: row }, 201);
});
route("PUT", "/credentials/:id", async (ctx) => {
  const b = await ctx.body(z.object({ name: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/).optional(), fields: z.record(z.string(), z.string().max(4096)).optional() }));
  const row = await updateCredential(ctx.params.id, b);
  await audit("credential.update", "success", { userId: ctx.session!.user.id, target: ctx.params.id });
  return json({ credential: row });
});
route("DELETE", "/credentials/:id", async (ctx) => {
  await db.delete(credentials).where(eq(credentials.id, ctx.params.id));
  await audit("credential.delete", "success", { userId: ctx.session!.user.id, target: ctx.params.id });
  return json({ ok: true });
});

// ---------------- identities ----------------
route("GET", "/identities", async () => json({ identities: await db.select().from(identities).orderBy(desc(identities.createdAt)) }));
route("POST", "/identities", async (ctx) => {
  const b = await ctx.body(z.object({ name: z.string().min(1).max(80), description: z.string().max(500).default("") }));
  const id = newId();
  const [row] = await db.insert(identities).values({ id, name: b.name, description: b.description }).returning();
  identityDirs(id);
  await audit("identity.create", "success", { userId: ctx.session!.user.id, target: id });
  return json({ identity: row }, 201);
});
route("DELETE", "/identities/:id", async (ctx) => {
  const [i] = await db.select().from(identities).where(eq(identities.id, ctx.params.id)).limit(1);
  if (!i) throw errors.flow("IDENTITY_NOT_FOUND", "Identity not found", 404);
  if (i.lockedByExecutionId && i.lockExpiresAt && i.lockExpiresAt.getTime() > Date.now()) throw errors.flow("IDENTITY_LOCKED", "Identity is in use", 409);
  await db.delete(identities).where(eq(identities.id, i.id));
  fs.rmSync(identityDirs(i.id).root, { recursive: true, force: true });
  await audit("identity.delete", "success", { userId: ctx.session!.user.id, target: i.id });
  return json({ ok: true });
});
route("POST", "/identities/:id/reset-profile", async (ctx) => {
  const [i] = await db.select().from(identities).where(eq(identities.id, ctx.params.id)).limit(1);
  if (!i) throw errors.flow("IDENTITY_NOT_FOUND", "Identity not found", 404);
  if (i.lockedByExecutionId && i.lockExpiresAt && i.lockExpiresAt.getTime() > Date.now()) throw errors.flow("IDENTITY_LOCKED", "Identity is in use", 409);
  const dirs = identityDirs(i.id);
  fs.rmSync(dirs.profile, { recursive: true, force: true });
  fs.mkdirSync(dirs.profile, { recursive: true });
  return json({ ok: true });
});

// ---------------- settings ----------------
const SETTING_KEYS = ["defaultViewport", "screenshotOnNavigation", "uiTheme"] as const;
route("GET", "/settings", async () => {
  const rows = await db.select().from(appSettings);
  const values: Record<string, unknown> = {};
  for (const r of rows) values[r.key] = r.value;
  return json({ settings: values, limits: config.limits, worker: config.worker, scheduler: config.scheduler, authMode: config.authMode, privateAllowList: config.network.privateAllowList, warnings: validateConfig() });
});
route("PUT", "/settings", async (ctx) => {
  const b = await ctx.body(z.record(z.enum(SETTING_KEYS), z.unknown()));
  for (const [key, value] of Object.entries(b)) {
    await db.insert(appSettings).values({ key, value: value as Record<string, unknown> }).onConflictDoUpdate({ target: appSettings.key, set: { value: value as Record<string, unknown>, updatedAt: new Date() } });
  }
  return json({ ok: true });
});

// ---------------- system status / health / metrics ----------------
async function statusCounts() {
  const rows = await db.select({ status: executions.status, n: count() }).from(executions).groupBy(executions.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}
route("GET", "/system/status", async () => {
  const [ws, counts, art] = await Promise.all([db.select().from(workers).orderBy(desc(workers.lastHeartbeatAt)).limit(20), statusCounts(), db.select({ n: count(), bytes: sum(artifacts.sizeBytes) }).from(artifacts)]);
  const onlineWorkers = ws.filter((w) => w.status === "ONLINE" && Date.now() - w.lastHeartbeatAt.getTime() < config.worker.workerLostAfterMs);
  const ai = getAIProvider();
  let disk: { freeBytes: number; totalBytes: number } | null = null;
  try {
    const st = await fs.promises.statfs(config.dataDir);
    disk = { freeBytes: Number(st.bavail) * Number(st.bsize), totalBytes: Number(st.blocks) * Number(st.bsize) };
  } catch {
    disk = null;
  }
  return json({
    service: { name: "BrowserFlow", version: "1.0.0", nodeRegistryVersion: NODE_REGISTRY_VERSION, playwrightVersion: PLAYWRIGHT_VERSION, env: config.env, authMode: config.authMode },
    workers: ws,
    onlineWorkerCount: onlineWorkers.length,
    browserReady: onlineWorkers.some((w) => w.browserHealthy),
    executions: counts,
    artifacts: { count: Number(art[0]?.n ?? 0), bytes: Number(art[0]?.bytes ?? 0), quotaBytes: config.limits.maxTotalArtifactBytes },
    disk,
    ai: { provider: ai.name, enabled: ai.enabled, tools: AI_TOOL_SCHEMAS.map((t) => t.name) },
    configWarnings: validateConfig(),
  });
});
route("GET", "/ai/status", async () => {
  const ai = getAIProvider();
  return json({ provider: ai.name, enabled: ai.enabled, tools: AI_TOOL_SCHEMAS });
});
route("GET", "/health/live", async () => json({ status: "ok", service: config.serviceName }), { isPublic: true });
route("GET", "/health/ready", async () => {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const ws = dbOk ? await db.select({ id: workers.id, browserHealthy: workers.browserHealthy, lastHeartbeatAt: workers.lastHeartbeatAt, status: workers.status }).from(workers).where(eq(workers.status, "ONLINE")) : [];
  const live = ws.filter((w) => Date.now() - w.lastHeartbeatAt.getTime() < config.worker.workerLostAfterMs);
  const body = { status: dbOk ? "ready" : "unavailable", database: dbOk, workersOnline: live.length, browserReady: live.some((w) => w.browserHealthy) };
  return json(body, dbOk ? 200 : 503);
}, { isPublic: true });

const registry = new Registry();
collectDefaultMetrics({ register: registry });
const gExec = new Gauge({ name: "browserflow_executions_total", help: "Executions by status", labelNames: ["status"], registers: [registry] });
const gWorkers = new Gauge({ name: "browserflow_workers_online", help: "Online workers", registers: [registry] });
const gQueue = new Gauge({ name: "browserflow_queue_depth", help: "Queued executions", registers: [registry] });
const gArtifacts = new Gauge({ name: "browserflow_artifact_bytes", help: "Total artifact bytes", registers: [registry] });
route("GET", "/metrics", async () => {
  const [counts, ws, art] = await Promise.all([statusCounts(), db.select({ n: count() }).from(workers).where(and(eq(workers.status, "ONLINE"), sql`${workers.lastHeartbeatAt} > now() - make_interval(secs => ${config.worker.workerLostAfterMs / 1000})`)), db.select({ bytes: sum(artifacts.sizeBytes) }).from(artifacts)]);
  gExec.reset();
  for (const [status, n] of Object.entries(counts)) gExec.set({ status }, n);
  gWorkers.set(Number(ws[0]?.n ?? 0));
  gQueue.set(counts.QUEUED ?? 0);
  gArtifacts.set(Number(art[0]?.bytes ?? 0));
  return new Response(await registry.metrics(), { headers: { "content-type": registry.contentType } });
}, { isPublic: config.authMode === "local-only" });
