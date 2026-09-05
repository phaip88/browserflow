import fs from "node:fs";
import { z } from "zod";
import { and, asc, desc, eq, ilike, isNull, isNotNull, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import type { PoolClient } from "pg";
import { artifacts, executions, flowVersions, flows } from "@/db/schema";
import { json, route } from "./http";
import { audit, changePassword, clearSessionCookie, createAdmin, isInitialized, login, logout, sessionCookie } from "@/auth/service";
import { config } from "@/core/config";
import { checksumOf, errors, newId } from "@/core/security";
import { compileFlow, type ExecutionPlan } from "@/flow/compiler";
import { emptyFlowDefinition, flowDefinitionSchema, type FlowDefinition } from "@/flow/schema";
import { NODE_CATALOG } from "@/nodes/catalog";
import { TEMPLATES, getTemplate } from "@/templates";
import { createExecution, getExecutionSnapshot, listEventsAfter, listExecutions, requestCancel, requestLivePreview } from "@/execution/service";
import { resolveArtifactAbsolutePath } from "@/runtime/services";
import { logger } from "@/core/logger";

const compileLimits = { maxNodesPerFlow: config.limits.maxNodesPerFlow, maxNodeTimeoutMs: config.limits.maxNodeTimeoutMs, defaultFlowTimeoutMs: config.limits.flowTimeoutMs, maxLoopIterations: config.limits.maxLoopIterations };

// ---------------- auth ----------------
route("GET", "/auth/status", async ({ session }) => json({ initialized: await isInitialized(), mode: config.authMode, authenticated: Boolean(session), user: session?.user ?? null, csrfToken: session?.csrfToken ?? null }), { isPublic: true });
route("POST", "/auth/setup", async (ctx) => {
  const body = await ctx.body(z.object({ email: z.string().email(), password: z.string() }));
  if (await isInitialized()) throw errors.auth("ALREADY_INITIALIZED", "Administrator already initialized", 409);
  const user = await createAdmin(body.email, body.password);
  return json({ user }, 201);
}, { isPublic: true });
route("POST", "/auth/login", async (ctx) => {
  const body = await ctx.body(z.object({ email: z.string(), password: z.string() }));
  const { token, session, expiresAt } = await login(body.email, body.password, { ip: ctx.ip, userAgent: ctx.req.headers.get("user-agent") ?? "" });
  return json({ user: session.user, csrfToken: session.csrfToken }, 200, { "set-cookie": sessionCookie(token, expiresAt) });
}, { isPublic: true });
route("POST", "/auth/logout", async ({ session }) => {
  if (session && session.mode === "authenticated") await logout(session.sessionId);
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
});
route("GET", "/auth/me", async ({ session }) => json({ user: session!.user, csrfToken: session!.csrfToken, mode: session!.mode }));
route("POST", "/auth/change-password", async (ctx) => {
  const body = await ctx.body(z.object({ currentPassword: z.string(), newPassword: z.string() }));
  if (ctx.session!.mode !== "authenticated") throw errors.auth("LOCAL_ONLY", "Not available in local-only mode", 400);
  await changePassword(ctx.session!.user.id, body.currentPassword, body.newPassword, ctx.session!.sessionId);
  return json({ ok: true });
});

// ---------------- catalog & templates ----------------
route("GET", "/nodes", async () => json({ nodes: NODE_CATALOG }));
route("GET", "/templates", async () => json({ templates: TEMPLATES.map((t) => ({ id: t.id, name: t.name, description: t.description, category: t.category, nodeCount: t.definition.nodes.length })) }));
route("GET", "/templates/:id", async ({ params }) => {
  const t = getTemplate(params.id);
  if (!t) throw errors.flow("TEMPLATE_NOT_FOUND", "Template not found", 404);
  return json({ template: t });
});

// ---------------- flows ----------------
const flowSummary = { id: flows.id, name: flows.name, description: flows.description, currentVersionId: flows.currentVersionId, archivedAt: flows.archivedAt, draftUpdatedAt: flows.draftUpdatedAt, createdAt: flows.createdAt, updatedAt: flows.updatedAt, version: flows.version };

route("GET", "/flows", async ({ url }) => {
  const q = url.searchParams.get("q")?.trim();
  const archived = url.searchParams.get("archived") === "true";
  const sort = url.searchParams.get("sort") ?? "updated";
  const conds = [archived ? isNotNull(flows.archivedAt) : isNull(flows.archivedAt)];
  if (q) conds.push(ilike(flows.name, `%${q.replace(/[%_]/g, "\\$&")}%`));
  const order = sort === "name" ? asc(flows.name) : sort === "created" ? desc(flows.createdAt) : desc(flows.updatedAt);
  const rows = await db.select(flowSummary).from(flows).where(and(...conds)).orderBy(order).limit(200);
  return json({ flows: rows });
});

route("POST", "/flows", async (ctx) => {
  const body = await ctx.body(z.object({ name: z.string().min(1).max(120), description: z.string().max(2000).optional(), templateId: z.string().optional(), definition: z.unknown().optional() }));
  let definition: FlowDefinition;
  if (body.templateId) {
    const t = getTemplate(body.templateId);
    if (!t) throw errors.flow("TEMPLATE_NOT_FOUND", "Template not found", 404);
    definition = { ...structuredClone(t.definition), name: body.name };
  } else if (body.definition) {
    const parsed = flowDefinitionSchema.safeParse(body.definition);
    if (!parsed.success) throw errors.flow("INVALID_DEFINITION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    definition = { ...parsed.data, name: body.name };
  } else definition = emptyFlowDefinition(body.name);
  const id = newId();
  const [row] = await db.insert(flows).values({ id, name: body.name, description: body.description ?? definition.description ?? "", draftDefinition: definition, draftChecksum: checksumOf(definition) }).returning(flowSummary);
  await audit("flow.create", "success", { userId: ctx.session!.user.id, target: id });
  return json({ flow: row }, 201);
});

route("POST", "/flows/import", async (ctx) => {
  const body = await ctx.body(z.object({ definition: z.unknown(), name: z.string().max(120).optional() }));
  const parsed = flowDefinitionSchema.safeParse(body.definition);
  if (!parsed.success) throw errors.flow("INVALID_DEFINITION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const definition = { ...parsed.data, name: body.name ?? parsed.data.name };
  const compiled = compileFlow(definition, compileLimits);
  const id = newId();
  const [row] = await db.insert(flows).values({ id, name: definition.name, description: definition.description, draftDefinition: definition, draftChecksum: checksumOf(definition) }).returning(flowSummary);
  await audit("flow.import", "success", { userId: ctx.session!.user.id, target: id });
  return json({ flow: row, diagnostics: compiled.diagnostics }, 201);
});

async function loadFlow(id: string) {
  const [f] = await db.select().from(flows).where(eq(flows.id, id)).limit(1);
  if (!f) throw errors.flow("NOT_FOUND", "Flow not found", 404);
  return f;
}

route("GET", "/flows/:id", async ({ params }) => {
  const f = await loadFlow(params.id);
  const versions = await db.select({ id: flowVersions.id, versionNumber: flowVersions.versionNumber, flowChecksum: flowVersions.flowChecksum, compiledPlanChecksum: flowVersions.compiledPlanChecksum, nodeRegistryVersion: flowVersions.nodeRegistryVersion, notes: flowVersions.notes, createdAt: flowVersions.createdAt }).from(flowVersions).where(eq(flowVersions.flowId, f.id)).orderBy(desc(flowVersions.versionNumber));
  return json({ flow: f, versions });
});

route("PUT", "/flows/:id/draft", async (ctx) => {
  const body = await ctx.body(z.object({ definition: z.unknown(), expectedVersion: z.number().int().optional() }));
  const parsed = flowDefinitionSchema.safeParse(body.definition);
  if (!parsed.success) throw errors.flow("INVALID_DEFINITION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  const f = await loadFlow(ctx.params.id);
  if (f.archivedAt) throw errors.flow("ARCHIVED", "Flow is archived", 409);
  if (body.expectedVersion !== undefined && body.expectedVersion !== f.version) throw errors.flow("CONFLICT", "Draft was modified elsewhere; reload before saving", 409, { currentVersion: f.version });
  const def = { ...parsed.data, name: parsed.data.name || f.name };
  const now = new Date();
  const [row] = await db.update(flows).set({ draftDefinition: def, draftChecksum: checksumOf(def), name: def.name, description: def.description, draftUpdatedAt: now, updatedAt: now, version: f.version + 1 }).where(and(eq(flows.id, f.id), eq(flows.version, f.version))).returning(flowSummary);
  if (!row) throw errors.flow("CONFLICT", "Draft was modified concurrently", 409);
  return json({ flow: row });
});

route("PATCH", "/flows/:id", async (ctx) => {
  const body = await ctx.body(z.object({ name: z.string().min(1).max(120).optional(), description: z.string().max(2000).optional(), archived: z.boolean().optional() }));
  const f = await loadFlow(ctx.params.id);
  const patch: Partial<typeof flows.$inferInsert> = { updatedAt: new Date(), version: f.version + 1 };
  if (body.name) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.archived !== undefined) patch.archivedAt = body.archived ? new Date() : null;
  const [row] = await db.update(flows).set(patch).where(and(eq(flows.id, f.id), eq(flows.version, f.version))).returning(flowSummary);
  if (!row) throw errors.flow("CONFLICT", "Flow modified concurrently", 409);
  return json({ flow: row });
});

route("DELETE", "/flows/:id", async (ctx) => {
  const f = await loadFlow(ctx.params.id);
  const [active] = await db.select({ id: executions.id }).from(executions).where(and(eq(executions.flowId, f.id), sql`${executions.status} IN ('QUEUED','LEASED','STARTING','RUNNING','CANCELLING','WAITING_FOR_INPUT')`)).limit(1);
  if (active) throw errors.flow("HAS_ACTIVE_EXECUTIONS", "Cancel active executions before deleting the flow", 409);
  await db.delete(flows).where(eq(flows.id, f.id));
  await audit("flow.delete", "success", { userId: ctx.session!.user.id, target: f.id });
  return json({ ok: true });
});

route("POST", "/flows/:id/compile", async (ctx) => {
  const f = await loadFlow(ctx.params.id);
  let definition: unknown = f.draftDefinition;
  const text = await ctx.req.text();
  if (text) {
    const parsed = z.object({ definition: z.unknown().optional() }).safeParse(JSON.parse(text));
    if (parsed.success && parsed.data.definition) definition = parsed.data.definition;
  }
  const result = compileFlow(definition, compileLimits);
  return json({ ok: result.ok, diagnostics: result.diagnostics, estimate: result.compiled?.estimate ?? null, flowChecksum: result.compiled?.flowChecksum ?? null, compiledPlanChecksum: result.compiled?.compiledPlanChecksum ?? null });
});

route("POST", "/flows/:id/publish", async (ctx) => {
  const body = await ctx.body(z.object({ notes: z.string().max(500).optional() }).default({}));
  const f = await loadFlow(ctx.params.id);
  if (f.archivedAt) throw errors.flow("ARCHIVED", "Flow is archived", 409);
  const result = compileFlow(f.draftDefinition, compileLimits);
  if (!result.ok || !result.compiled) return json({ ok: false, diagnostics: result.diagnostics }, 422);
  const c = result.compiled;
  const version = await db.transaction(async (tx) => {
    const [last] = await tx.select({ n: sql<number>`coalesce(max(${flowVersions.versionNumber}), 0)` }).from(flowVersions).where(eq(flowVersions.flowId, f.id));
    const versionNumber = Number(last?.n ?? 0) + 1;
    const [v] = await tx.insert(flowVersions).values({ id: newId(), flowId: f.id, versionNumber, definition: c.definition, compiledPlan: c.plan, flowChecksum: c.flowChecksum, compiledPlanChecksum: c.compiledPlanChecksum, nodeRegistryVersion: c.nodeRegistryVersion, notes: body.notes ?? "" }).returning();
    const [upd] = await tx.update(flows).set({ currentVersionId: v.id, updatedAt: new Date(), version: f.version + 1 }).where(and(eq(flows.id, f.id), eq(flows.version, f.version))).returning({ id: flows.id });
    if (!upd) throw errors.flow("CONFLICT", "Flow modified concurrently during publish", 409);
    return v;
  });
  await audit("flow.publish", "success", { userId: ctx.session!.user.id, target: f.id, metadata: { versionNumber: version.versionNumber } });
  return json({ ok: true, version: { id: version.id, versionNumber: version.versionNumber, flowChecksum: version.flowChecksum, compiledPlanChecksum: version.compiledPlanChecksum }, diagnostics: result.diagnostics, estimate: c.estimate }, 201);
});

route("POST", "/flows/:id/duplicate", async (ctx) => {
  const f = await loadFlow(ctx.params.id);
  const def = { ...(f.draftDefinition as FlowDefinition), name: `${f.name} (copy)` };
  const id = newId();
  const [row] = await db.insert(flows).values({ id, name: def.name, description: f.description, draftDefinition: def, draftChecksum: checksumOf(def) }).returning(flowSummary);
  return json({ flow: row }, 201);
});

route("GET", "/flows/:id/export", async ({ params }) => {
  const f = await loadFlow(params.id);
  const payload = { browserflowExport: 1, exportedAt: new Date().toISOString(), definition: f.draftDefinition };
  return json(payload, 200, { "content-disposition": `attachment; filename="${f.name.replace(/[^A-Za-z0-9_-]+/g, "_")}.flow.json"` });
});

route("GET", "/flows/:id/versions/:vid", async ({ params }) => {
  const [v] = await db.select().from(flowVersions).where(and(eq(flowVersions.id, params.vid), eq(flowVersions.flowId, params.id))).limit(1);
  if (!v) throw errors.flow("VERSION_NOT_FOUND", "Version not found", 404);
  return json({ version: v });
});

route("POST", "/flows/:id/versions/:vid/restore", async (ctx) => {
  const f = await loadFlow(ctx.params.id);
  const [v] = await db.select().from(flowVersions).where(and(eq(flowVersions.id, ctx.params.vid), eq(flowVersions.flowId, f.id))).limit(1);
  if (!v) throw errors.flow("VERSION_NOT_FOUND", "Version not found", 404);
  const def = v.definition as FlowDefinition;
  const [row] = await db.update(flows).set({ draftDefinition: def, draftChecksum: checksumOf(def), draftUpdatedAt: new Date(), updatedAt: new Date(), version: f.version + 1 }).where(and(eq(flows.id, f.id), eq(flows.version, f.version))).returning(flowSummary);
  if (!row) throw errors.flow("CONFLICT", "Flow modified concurrently", 409);
  return json({ flow: row });
});

route("POST", "/flows/:id/run", async (ctx) => {
  const body = await ctx.body(z.object({ flowVersionId: z.string().optional(), inputs: z.record(z.string(), z.unknown()).optional(), identityId: z.string().nullable().optional() }).default({}));
  const ex = await createExecution({ flowId: ctx.params.id, flowVersionId: body.flowVersionId, triggerType: "manual", inputs: body.inputs, identityId: body.identityId ?? null, actor: { kind: "user", id: ctx.session!.user.id } });
  return json({ execution: ex }, 201);
});

// ---------------- executions ----------------
route("GET", "/executions", async ({ url }) => json({ executions: await listExecutions({ flowId: url.searchParams.get("flowId") ?? undefined, status: url.searchParams.get("status") ?? undefined, limit: Number(url.searchParams.get("limit") ?? 50), offset: Number(url.searchParams.get("offset") ?? 0) }) }));
route("GET", "/executions/:id", async ({ params }) => {
  const snap = await getExecutionSnapshot(params.id);
  const plan = (snap.flowVersion?.compiledPlan ?? null) as ExecutionPlan | null;
  return json({ ...snap, flowVersion: snap.flowVersion ? { id: snap.flowVersion.id, versionNumber: snap.flowVersion.versionNumber, definition: snap.flowVersion.definition, order: plan?.order ?? [] } : null });
});
route("POST", "/executions/:id/cancel", async (ctx) => json(await requestCancel(ctx.params.id, { kind: "user", id: ctx.session!.user.id })));
route("POST", "/executions/:id/live-preview", async (ctx) => {
  await requestLivePreview(ctx.params.id);
  return json({ ok: true, ttlMs: config.limits.livePreviewTtlMs });
});
route("GET", "/executions/:id/events", async ({ params, url }) => {
  const after = Number(url.searchParams.get("after") ?? 0);
  const events = await listEventsAfter(params.id, Number.isFinite(after) ? after : 0, 1000);
  return json({ events });
});

/** Server-Sent Events: replay from lastSequence, then live tail (LISTEN/NOTIFY wake-ups with polling fallback). */
route("GET", "/executions/:id/stream", async ({ params, url }) => {
  const executionId = params.id;
  await getExecutionSnapshot(executionId);
  let last = Number(url.searchParams.get("lastSequence") ?? 0);
  if (!Number.isFinite(last) || last < 0) last = 0;
  const encoder = new TextEncoder();
  let closed = false;
  let timer: NodeJS.Timeout | null = null;
  let listener: PoolClient | null = null;
  const releaseListener = () => {
    const c = listener;
    listener = null;
    if (c) c.query("UNLISTEN bf_events").catch(() => undefined).finally(() => c.release());
  };
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const seen = new Set<string>();
      const pump = async () => {
        if (closed) return;
        try {
          const events = await listEventsAfter(executionId, last, 500);
          for (const e of events) {
            if (seen.has(e.id)) continue; // event_id de-duplication
            seen.add(e.id);
            last = Math.max(last, e.sequence);
            send("event", { schemaVersion: 1, eventId: e.id, sequence: e.sequence, timestamp: e.createdAt.toISOString(), executionId: e.executionId, attemptId: e.attemptId, traceId: e.traceId, type: e.type, payload: e.payload });
          }
          const [ex] = await db.select({ status: executions.status, eventSequence: executions.eventSequence }).from(executions).where(eq(executions.id, executionId)).limit(1);
          if (ex && ["SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(ex.status) && last >= ex.eventSequence) {
            send("done", { status: ex.status, lastSequence: last });
            cleanup();
            controller.close();
          }
        } catch (e) {
          logger.warn("sse pump error", { execution_id: executionId, err: (e as Error).message });
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        releaseListener();
      };
      send("ready", { lastSequence: last, replay: true });
      try {
        const client: PoolClient = await pool.connect();
        listener = client;
        await client.query("LISTEN bf_events");
        client.on("notification", (msg: { payload?: string }) => {
          if (msg.payload && msg.payload.startsWith(executionId)) void pump();
        });
        client.on("error", () => undefined);
      } catch {
        listener = null; // fall back to pure polling
      }
      await pump();
      timer = setInterval(pump, listener ? 3000 : 1000);
      const heartbeat = setInterval(() => {
        if (closed) return clearInterval(heartbeat);
        controller.enqueue(encoder.encode(`: ping\n\n`));
      }, 15000);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
      releaseListener();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
});

route("GET", "/artifacts/:id/content", async ({ params }) => {
  const [a] = await db.select().from(artifacts).where(eq(artifacts.id, params.id)).limit(1);
  if (!a) throw errors.file("NOT_FOUND", "Artifact not found", 404);
  const abs = resolveArtifactAbsolutePath(a.relativePath);
  if (!fs.existsSync(abs)) throw errors.file("MISSING_ON_DISK", "Artifact file missing", 410);
  const data = await fs.promises.readFile(abs);
  const safeType = /^(image\/(jpeg|png)|text\/plain|application\/json)$/.test(a.contentType) ? a.contentType : "application/octet-stream";
  return new Response(data, { headers: { "content-type": safeType, "content-length": String(data.length), "content-disposition": `${safeType.startsWith("image/") ? "inline" : "attachment"}; filename="${a.filename}"`, "x-content-type-options": "nosniff" } });
});
