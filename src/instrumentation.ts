/**
 * Optional embedded supervisor: when BROWSERFLOW_EMBEDDED_SUPERVISOR=true (default outside Docker),
 * the API process spawns the scheduler and browser worker as SEPARATE OS processes so a single
 * `next start` yields a working system. In Docker Compose they run as dedicated services.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { config, validateConfig, ensureDirectories } = await import("@/core/config");
  const { logger } = await import("@/core/logger");
  for (const f of validateConfig()) logger.warn(f.message);
  ensureDirectories();
  if (!config.embeddedSupervisor || process.env.BROWSERFLOW_SUPERVISOR_CHILD) return;
  const { spawn } = await import("node:child_process");
  const path = await import("node:path");
  const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const start = (name: string, entry: string) => {
    let stopped = false;
    const launch = () => {
      const child = spawn(tsx, [entry], { stdio: "inherit", env: { ...process.env, BROWSERFLOW_SERVICE: name, BROWSERFLOW_SUPERVISOR_CHILD: "1" } });
      logger.info(`supervisor started ${name}`, { pid: child.pid });
      child.on("exit", (code) => {
        if (stopped) return;
        logger.warn(`${name} exited; restarting in 3s`, { code });
        setTimeout(launch, 3000);
      });
      const shutdown = () => {
        stopped = true;
        child.kill("SIGTERM");
      };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
    };
    launch();
  };
  start("scheduler", "scheduler/main.ts");
  start("browser-worker", "worker/main.ts");
}
