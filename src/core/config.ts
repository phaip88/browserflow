import fs from "node:fs";
import path from "node:path";

/**
 * Central configuration. Values are read once from process.env, validated,
 * and dangerous combinations are rejected (fail-fast) or warned about.
 * Secrets are never logged from here.
 */
function int(name: string, def: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`Config ${name}=${raw} out of range [${min}, ${max}]`);
  }
  return Math.floor(n);
}
function bool(name: string, def: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return def;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}
function str(name: string, def: string): string {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? def : raw;
}

const rootDir = process.cwd();
const dataDir = path.resolve(rootDir, str("BROWSERFLOW_DATA_DIR", "data"));
const runtimeDir = path.resolve(rootDir, str("BROWSERFLOW_RUNTIME_DIR", "runtime"));

export const config = {
  env: str("NODE_ENV", "development"),
  serviceName: str("BROWSERFLOW_SERVICE", "api"),
  bindHost: str("BROWSERFLOW_BIND_HOST", "127.0.0.1"),
  authMode: str("BROWSERFLOW_AUTH_MODE", "authenticated") as "authenticated" | "local-only",
  secureCookies: bool("BROWSERFLOW_SECURE_COOKIES", process.env.NODE_ENV === "production" && process.env.BROWSERFLOW_BIND_HOST !== "127.0.0.1"),
  corsOrigins: str("BROWSERFLOW_CORS_ORIGINS", "").split(",").map((s) => s.trim()).filter(Boolean),
  sessionTtlHours: int("BROWSERFLOW_SESSION_TTL_HOURS", 24 * 7, 1, 24 * 90),
  loginMaxAttempts: int("BROWSERFLOW_LOGIN_MAX_ATTEMPTS", 5, 1, 100),
  loginWindowSec: int("BROWSERFLOW_LOGIN_WINDOW_SEC", 300, 10, 86400),
  masterKeyFile: str("BROWSERFLOW_MASTER_KEY_FILE", path.join(rootDir, "secrets", "master.key")),
  dataDir,
  runtimeDir,
  identitiesDir: path.join(dataDir, "identities"),
  artifactsDir: path.join(dataDir, "artifacts"),
  executionsRuntimeDir: path.join(runtimeDir, "executions"),
  aiProvider: str("BROWSERFLOW_AI_PROVIDER", "disabled"),
  limits: {
    browserConcurrency: int("BROWSERFLOW_BROWSER_CONCURRENCY", 1, 1, 2),
    flowTimeoutMs: int("BROWSERFLOW_FLOW_TIMEOUT_MS", 15 * 60 * 1000, 1000, 6 * 60 * 60 * 1000),
    nodeTimeoutMs: int("BROWSERFLOW_NODE_TIMEOUT_MS", 30_000, 100, 60 * 60 * 1000),
    maxNodeTimeoutMs: int("BROWSERFLOW_MAX_NODE_TIMEOUT_MS", 10 * 60 * 1000, 1000, 6 * 60 * 60 * 1000),
    maxLoopIterations: int("BROWSERFLOW_MAX_LOOP_ITERATIONS", 1000, 1, 100_000),
    maxNodeExecutions: int("BROWSERFLOW_MAX_NODE_EXECUTIONS", 20_000, 10, 1_000_000),
    maxNodesPerFlow: int("BROWSERFLOW_MAX_NODES_PER_FLOW", 500, 1, 5000),
    maxPages: int("BROWSERFLOW_MAX_PAGES", 5, 1, 50),
    maxArtifactBytes: int("BROWSERFLOW_MAX_ARTIFACT_BYTES", 25 * 1024 * 1024, 1024, 2 * 1024 * 1024 * 1024),
    maxArtifactsPerExecution: int("BROWSERFLOW_MAX_ARTIFACTS_PER_EXECUTION", 200, 1, 10_000),
    maxExecutionArtifactBytes: int("BROWSERFLOW_MAX_EXECUTION_ARTIFACT_BYTES", 200 * 1024 * 1024, 1024, 20 * 1024 * 1024 * 1024),
    maxTotalArtifactBytes: int("BROWSERFLOW_MAX_TOTAL_ARTIFACT_BYTES", 10 * 1024 * 1024 * 1024, 1024 * 1024, 1024 * 1024 * 1024 * 1024),
    maxHttpBodyBytes: int("BROWSERFLOW_MAX_HTTP_BODY_BYTES", 5 * 1024 * 1024, 1024, 100 * 1024 * 1024),
    maxHttpRedirects: int("BROWSERFLOW_MAX_HTTP_REDIRECTS", 5, 0, 20),
    maxScreenshotBytes: int("BROWSERFLOW_MAX_SCREENSHOT_BYTES", 2 * 1024 * 1024, 1024, 50 * 1024 * 1024),
    livePreviewIntervalMs: int("BROWSERFLOW_LIVE_PREVIEW_INTERVAL_MS", 4000, 3000, 5000),
    livePreviewTtlMs: int("BROWSERFLOW_LIVE_PREVIEW_TTL_MS", 20_000, 5000, 120_000),
    retentionDays: int("BROWSERFLOW_RETENTION_DAYS", 30, 1, 3650),
    browserMemoryMb: int("BROWSERFLOW_BROWSER_MEMORY_MB", 1024, 256, 16384),
  },
  worker: {
    heartbeatIntervalMs: int("BROWSERFLOW_HEARTBEAT_INTERVAL_MS", 5000, 1000, 60_000),
    leaseTtlMs: int("BROWSERFLOW_LEASE_TTL_MS", 30_000, 5000, 600_000),
    pollIntervalMs: int("BROWSERFLOW_WORKER_POLL_INTERVAL_MS", 1500, 200, 60_000),
    gracefulShutdownMs: int("BROWSERFLOW_GRACEFUL_SHUTDOWN_MS", 30_000, 1000, 600_000),
    browserSelfCheckIntervalMs: int("BROWSERFLOW_BROWSER_SELFCHECK_INTERVAL_MS", 300_000, 10_000, 3_600_000),
    workerLostAfterMs: int("BROWSERFLOW_WORKER_LOST_AFTER_MS", 45_000, 5000, 600_000),
    chromiumNoSandbox: bool("BROWSERFLOW_CHROMIUM_NO_SANDBOX", true),
  },
  scheduler: {
    pollIntervalMs: int("BROWSERFLOW_SCHEDULER_POLL_INTERVAL_MS", 5000, 500, 60_000),
    catchUpLimit: int("BROWSERFLOW_SCHEDULER_CATCHUP_LIMIT", 5, 1, 100),
    misfireGraceMs: int("BROWSERFLOW_SCHEDULER_MISFIRE_GRACE_MS", 60_000, 1000, 3_600_000),
  },
  network: {
    privateAllowList: str("BROWSERFLOW_NETWORK_PRIVATE_ALLOWLIST", "").split(",").map((s) => s.trim()).filter(Boolean),
    allowedSchemes: ["http:", "https:"],
  },
  embeddedSupervisor: bool("BROWSERFLOW_EMBEDDED_SUPERVISOR", true),
};

export type AppConfig = typeof config;

export interface ConfigCheck {
  level: "error" | "warning" | "info";
  message: string;
}

/** Validate config; returns findings. Throws on hard conflicts. */
export function validateConfig(): ConfigCheck[] {
  const findings: ConfigCheck[] = [];
  if (config.authMode === "local-only" && config.bindHost !== "127.0.0.1" && config.bindHost !== "localhost") {
    throw new Error("BROWSERFLOW_AUTH_MODE=local-only is only permitted when BROWSERFLOW_BIND_HOST=127.0.0.1");
  }
  if (config.env === "production" && config.aiProvider === "fake") {
    throw new Error("Fake AI provider is test-only and must not be configured in production");
  }
  if (config.worker.leaseTtlMs < config.worker.heartbeatIntervalMs * 3) {
    throw new Error("BROWSERFLOW_LEASE_TTL_MS must be at least 3x BROWSERFLOW_HEARTBEAT_INTERVAL_MS");
  }
  if (config.network.privateAllowList.length > 0) {
    findings.push({ level: "warning", message: `Private network allow-list enabled for ${config.network.privateAllowList.length} entries` });
  }
  if (config.limits.browserConcurrency > 1) {
    findings.push({ level: "warning", message: "Browser concurrency > 1 increases memory pressure on the worker" });
  }
  if (config.authMode === "local-only") {
    findings.push({ level: "warning", message: "Running in local-only mode without authentication (loopback bind only)" });
  }
  if (config.env === "production" && !config.secureCookies && config.bindHost !== "127.0.0.1") {
    findings.push({ level: "warning", message: "Secure cookies are disabled while binding a non-loopback address" });
  }
  return findings;
}

export function ensureDirectories(): void {
  for (const d of [config.dataDir, config.runtimeDir, config.identitiesDir, config.artifactsDir, config.executionsRuntimeDir]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
