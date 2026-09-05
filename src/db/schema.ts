import {
  pgTable,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  uniqueIndex,
  index,
  bigint,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: integer("version").notNull().default(1),
});

export const userSessions = pgTable(
  "user_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    csrfToken: text("csrf_token").notNull(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("user_sessions_user_idx").on(t.userId), index("user_sessions_expires_idx").on(t.expiresAt)],
);

export const flows = pgTable(
  "flows",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    draftDefinition: jsonb("draft_definition").notNull(),
    draftChecksum: text("draft_checksum").notNull(),
    draftUpdatedAt: ts("draft_updated_at").notNull().defaultNow(),
    currentVersionId: text("current_version_id"),
    archivedAt: ts("archived_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    version: integer("version").notNull().default(1),
  },
  (t) => [index("flows_name_idx").on(t.name), index("flows_archived_idx").on(t.archivedAt)],
);

export const flowVersions = pgTable(
  "flow_versions",
  {
    id: text("id").primaryKey(),
    flowId: text("flow_id").notNull().references(() => flows.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    definition: jsonb("definition").notNull(),
    compiledPlan: jsonb("compiled_plan").notNull(),
    flowChecksum: text("flow_checksum").notNull(),
    compiledPlanChecksum: text("compiled_plan_checksum").notNull(),
    nodeRegistryVersion: text("node_registry_version").notNull(),
    notes: text("notes").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("flow_versions_flow_number_uq").on(t.flowId, t.versionNumber)],
);

export const executions = pgTable(
  "executions",
  {
    id: text("id").primaryKey(),
    flowId: text("flow_id").notNull().references(() => flows.id, { onDelete: "cascade" }),
    flowVersionId: text("flow_version_id").notNull().references(() => flowVersions.id, { onDelete: "cascade" }),
    flowChecksum: text("flow_checksum").notNull(),
    compiledPlanChecksum: text("compiled_plan_checksum").notNull(),
    nodeRegistryVersion: text("node_registry_version").notNull(),
    status: text("status").notNull(),
    triggerType: text("trigger_type").notNull(),
    scheduleId: text("schedule_id"),
    identityId: text("identity_id"),
    currentAttemptId: text("current_attempt_id"),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(1),
    inputs: jsonb("inputs").notNull().default({}),
    output: jsonb("output"),
    currentNodeId: text("current_node_id"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    configSnapshot: jsonb("config_snapshot").notNull().default({}),
    browserVersion: text("browser_version"),
    playwrightVersion: text("playwright_version"),
    timeoutMs: integer("timeout_ms").notNull(),
    livePreviewUntil: ts("live_preview_until"),
    cancelRequestedAt: ts("cancel_requested_at"),
    queuedAt: ts("queued_at"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    eventSequence: integer("event_sequence").notNull().default(0),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("executions_status_idx").on(t.status, t.createdAt),
    index("executions_flow_idx").on(t.flowId, t.createdAt),
    index("executions_schedule_idx").on(t.scheduleId),
  ],
);

export const executionAttempts = pgTable(
  "execution_attempts",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    workerId: text("worker_id"),
    leaseToken: text("lease_token"),
    status: text("status").notNull(),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("execution_attempts_exec_number_uq").on(t.executionId, t.attemptNumber)],
);

export const executionLeases = pgTable(
  "execution_leases",
  {
    executionId: text("execution_id").primaryKey().references(() => executions.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id").notNull(),
    workerId: text("worker_id").notNull(),
    leaseToken: text("lease_token").notNull(),
    acquiredAt: ts("acquired_at").notNull().defaultNow(),
    heartbeatAt: ts("heartbeat_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [index("execution_leases_expires_idx").on(t.expiresAt)],
);

export const nodeExecutions = pgTable(
  "node_executions",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id").notNull(),
    nodeId: text("node_id").notNull(),
    nodeType: text("node_type").notNull(),
    scopePath: text("scope_path").notNull().default(""),
    ordinal: integer("ordinal").notNull(),
    status: text("status").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").notNull().default(0),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    durationMs: integer("duration_ms"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("node_executions_attempt_ordinal_uq").on(t.attemptId, t.ordinal),
    index("node_executions_exec_idx").on(t.executionId),
  ],
);

export const executionEvents = pgTable(
  "execution_events",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id"),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    traceId: text("trace_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("execution_events_exec_seq_uq").on(t.executionId, t.sequence)],
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => executionEvents.id, { onDelete: "cascade" }),
    executionId: text("execution_id").notNull(),
    attempts: integer("attempts").notNull().default(0),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_unpublished_idx").on(t.publishedAt, t.createdAt)],
);

export const schedules = pgTable(
  "schedules",
  {
    id: text("id").primaryKey(),
    flowId: text("flow_id").notNull().references(() => flows.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    cronExpression: text("cron_expression"),
    runAt: ts("run_at"),
    timezone: text("timezone").notNull().default("UTC"),
    enabled: boolean("enabled").notNull().default(true),
    misfirePolicy: text("misfire_policy").notNull().default("RUN_ONCE"),
    overlapPolicy: text("overlap_policy").notNull().default("SKIP"),
    identityId: text("identity_id"),
    inputs: jsonb("inputs").notNull().default({}),
    lastFireAt: ts("last_fire_at"),
    nextFireAt: ts("next_fire_at"),
    lastExecutionId: text("last_execution_id"),
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("schedules_next_fire_idx").on(t.enabled, t.nextFireAt)],
);

export const scheduleFires = pgTable(
  "schedule_fires",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id").notNull().references(() => schedules.id, { onDelete: "cascade" }),
    plannedFireTime: ts("planned_fire_time").notNull(),
    executionId: text("execution_id"),
    outcome: text("outcome").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("schedule_fires_uq").on(t.scheduleId, t.plannedFireTime)],
);

export const credentials = pgTable("credentials", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  kind: text("kind").notNull(),
  fieldNames: jsonb("field_names").notNull().default([]),
  ciphertext: text("ciphertext").notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: integer("version").notNull().default(1),
});

export const identities = pgTable("identities", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  lockedByExecutionId: text("locked_by_execution_id"),
  lockToken: text("lock_token"),
  lockExpiresAt: ts("lock_expires_at"),
  lastUsedAt: ts("last_used_at"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  version: integer("version").notNull().default(1),
});

export const artifacts = pgTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    executionId: text("execution_id").notNull().references(() => executions.id, { onDelete: "cascade" }),
    attemptId: text("attempt_id"),
    nodeId: text("node_id"),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    relativePath: text("relative_path").notNull().unique(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("artifacts_exec_idx").on(t.executionId)],
);

export const workers = pgTable("workers", {
  id: text("id").primaryKey(),
  hostname: text("hostname").notNull(),
  pid: integer("pid").notNull(),
  status: text("status").notNull(),
  capacity: integer("capacity").notNull().default(1),
  capabilities: jsonb("capabilities").notNull().default([]),
  playwrightVersion: text("playwright_version"),
  browserVersion: text("browser_version"),
  browserHealthy: boolean("browser_healthy").notNull().default(false),
  lastHeartbeatAt: ts("last_heartbeat_at").notNull().defaultNow(),
  startedAt: ts("started_at").notNull().defaultNow(),
  stoppedAt: ts("stopped_at"),
});

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
});

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    userId: text("user_id"),
    action: text("action").notNull(),
    target: text("target"),
    ip: text("ip"),
    outcome: text("outcome").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_events_action_idx").on(t.action, t.createdAt)],
);

export type ExecutionRow = typeof executions.$inferSelect;
export type FlowRow = typeof flows.$inferSelect;
export type FlowVersionRow = typeof flowVersions.$inferSelect;
export type ScheduleRow = typeof schedules.$inferSelect;
export type NodeExecutionRow = typeof nodeExecutions.$inferSelect;
