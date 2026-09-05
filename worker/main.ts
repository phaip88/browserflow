import "dotenv/config";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
process.env.BROWSERFLOW_SERVICE = process.env.BROWSERFLOW_SERVICE || "browser-worker";
import { config, ensureDirectories, validateConfig } from "@/core/config";
import { logger } from "@/core/logger";
import { newId } from "@/core/security";
import { acquireLease, markWorkerStopped, recoverExpiredLeases, registerWorker, workerHeartbeat } from "@/execution/service";
import { runExecution } from "@/execution/engine";
import { PLAYWRIGHT_VERSION, browserSelfCheck } from "@/runtime/browser-session";
import { pool } from "@/db";

/**
 * Browser Worker process: leases QUEUED executions from PostgreSQL, runs them with Playwright Chromium,
 * heartbeats leases, and drains gracefully on SIGTERM. Never runs inside the API process.
 */
async function main(): Promise<void> {
  for (const f of validateConfig()) logger[f.level === "error" ? "error" : "warn"](f.message);
  ensureDirectories();
  const workerId = process.env.BROWSERFLOW_WORKER_ID || `${os.hostname()}-${process.pid}-${newId().slice(0, 8)}`;
  const capabilities = ["browser", "network", "filesystem"];
  const capacity = config.limits.browserConcurrency;
  let draining = false;
  const running = new Set<Promise<void>>();

  let selfCheck = await browserSelfCheck();
  if (!selfCheck.ok) logger.error("browser self-check failed", { worker_id: workerId, error_code: "BF-BROWSER-SELFCHECK", err: selfCheck.error });
  await registerWorker({ workerId, hostname: os.hostname(), pid: process.pid, capacity, capabilities, playwrightVersion: PLAYWRIGHT_VERSION, browserVersion: selfCheck.version, browserHealthy: selfCheck.ok });
  fs.writeFileSync(path.join(config.runtimeDir, "browser-version.txt"), `playwright=${PLAYWRIGHT_VERSION}\nchromium=${selfCheck.version ?? "unavailable"}\nhealthy=${selfCheck.ok}\n`);
  logger.info("worker online", { worker_id: workerId, capacity, playwright: PLAYWRIGHT_VERSION, chromium: selfCheck.version });

  // Clean stale runtime dirs from previous crashed runs of this host
  try {
    for (const d of fs.readdirSync(config.executionsRuntimeDir)) fs.rmSync(path.join(config.executionsRuntimeDir, d), { recursive: true, force: true });
  } catch {
    /* nothing to clean */
  }

  const hb = setInterval(() => {
    workerHeartbeat(workerId, draining ? "DRAINING" : "ONLINE", selfCheck.ok).catch((e) => logger.warn("worker heartbeat failed", { worker_id: workerId, err: (e as Error).message }));
  }, config.worker.heartbeatIntervalMs);
  const sc = setInterval(async () => {
    if (running.size > 0) return; // don't launch a second Chromium while busy
    selfCheck = await browserSelfCheck();
    if (!selfCheck.ok) logger.error("periodic browser self-check failed", { worker_id: workerId, err: selfCheck.error });
  }, config.worker.browserSelfCheckIntervalMs);
  const reaper = setInterval(() => {
    recoverExpiredLeases({ kind: "worker", id: workerId }).catch((e) => logger.warn("lease recovery failed", { err: (e as Error).message }));
  }, Math.max(config.worker.leaseTtlMs / 2, 5000));

  const shutdown = async (signal: string) => {
    if (draining) return;
    draining = true;
    logger.info("worker draining", { worker_id: workerId, signal, running: running.size });
    const deadline = Date.now() + config.worker.gracefulShutdownMs;
    while (running.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
    clearInterval(hb);
    clearInterval(sc);
    clearInterval(reaper);
    await markWorkerStopped(workerId).catch(() => undefined);
    await pool.end().catch(() => undefined);
    logger.info("worker stopped", { worker_id: workerId, abandoned: running.size });
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));

  let backoff = config.worker.pollIntervalMs;
  for (;;) {
    if (draining) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    if (running.size >= capacity) {
      await Promise.race([...running]);
      continue;
    }
    try {
      const work = await acquireLease(workerId, capabilities);
      backoff = config.worker.pollIntervalMs;
      if (!work) {
        await new Promise((r) => setTimeout(r, config.worker.pollIntervalMs));
        continue;
      }
      logger.info("leased execution", { worker_id: workerId, execution_id: work.execution.id, attempt_id: work.attempt.id, attempt: work.attempt.attemptNumber });
      const p = runExecution(work, { isDraining: () => draining })
        .catch((e) => logger.error("execution crashed in engine", { execution_id: work.execution.id, err: (e as Error).message }))
        .finally(() => running.delete(p));
      running.add(p);
    } catch (e) {
      // Database unavailable or transient failure: back off and keep polling (no in-memory queue)
      logger.error("worker loop error", { worker_id: workerId, err: (e as Error).message });
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}

main().catch((e) => {
  logger.error("worker fatal", { err: (e as Error).message });
  process.exit(1);
});
