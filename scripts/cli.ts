import "dotenv/config";
process.env.BROWSERFLOW_SERVICE = "cli";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { credentials, executions, flowVersions, flows, identities, schedules, users } from "@/db/schema";
import { config, ensureDirectories, validateConfig } from "@/core/config";
import { createAdmin, resetPassword } from "@/auth/service";
import { checksumOf, decryptJson, loadMasterKey, sha256Hex, newId } from "@/core/security";
import { compileFlow } from "@/flow/compiler";
import { getTemplate } from "@/templates";
import { acquireLease, createExecution, getExecutionSnapshot, registerWorker } from "@/execution/service";
import { runExecution } from "@/execution/engine";
import { browserSelfCheck, PLAYWRIGHT_VERSION } from "@/runtime/browser-session";
import { runCleanup } from "../scheduler/main";

const out = (o: unknown) => process.stdout.write((typeof o === "string" ? o : JSON.stringify(o, null, 2)) + "\n");
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

async function doctor(): Promise<number> {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  try {
    await db.execute(sql`select 1`);
    checks.push({ name: "postgres", ok: true, detail: "connected" });
  } catch (e) {
    checks.push({ name: "postgres", ok: false, detail: (e as Error).message });
  }
  try {
    const r = await db.execute<{ n: string }>(sql`select count(*)::text as n from information_schema.tables where table_schema='public'`);
    checks.push({ name: "schema", ok: Number(r.rows[0]?.n) >= 18, detail: `${r.rows[0]?.n} tables` });
  } catch (e) {
    checks.push({ name: "schema", ok: false, detail: (e as Error).message });
  }
  try {
    loadMasterKey();
    checks.push({ name: "master-key", ok: true, detail: config.masterKeyFile });
  } catch (e) {
    checks.push({ name: "master-key", ok: false, detail: (e as Error).message });
  }
  for (const d of [config.dataDir, config.artifactsDir, config.identitiesDir, config.runtimeDir]) {
    try {
      fs.mkdirSync(d, { recursive: true });
      fs.accessSync(d, fs.constants.W_OK);
      checks.push({ name: `writable:${path.relative(process.cwd(), d)}`, ok: true, detail: "ok" });
    } catch (e) {
      checks.push({ name: `writable:${d}`, ok: false, detail: (e as Error).message });
    }
  }
  const bs = await browserSelfCheck();
  checks.push({ name: "chromium", ok: bs.ok, detail: bs.ok ? `chromium ${bs.version} / playwright ${PLAYWRIGHT_VERSION}` : (bs.error ?? "failed") });
  try {
    const st = fs.statfsSync(config.dataDir);
    const free = Number(st.bavail) * Number(st.bsize);
    checks.push({ name: "disk", ok: free > 500 * 1024 * 1024, detail: `${(free / 1024 / 1024 / 1024).toFixed(2)} GiB free` });
  } catch (e) {
    checks.push({ name: "disk", ok: false, detail: (e as Error).message });
  }
  const users_ = await db.select({ id: users.id }).from(users);
  checks.push({ name: "admin-initialized", ok: users_.length > 0, detail: `${users_.length} user(s)` });
  for (const w of validateConfig()) checks.push({ name: `config:${w.level}`, ok: w.level !== "error", detail: w.message });
  out({ checks, healthy: checks.every((c) => c.ok) });
  return checks.every((c) => c.ok) ? 0 : 1;
}

async function backup(dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  const dbUrl = process.env.DATABASE_URL!;
  const dumpPath = path.join(dir, "database.sql");
  execFileSync("pg_dump", ["--no-owner", "--no-privileges", "-f", dumpPath, dbUrl], { stdio: "inherit" });
  const copyDir = (src: string, dst: string) => {
    if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true, filter: (p) => !p.endsWith("profile.lock") && !/SingletonLock|SingletonCookie|SingletonSocket/.test(p) });
  };
  copyDir(config.artifactsDir, path.join(dir, "artifacts"));
  copyDir(config.identitiesDir, path.join(dir, "identities"));
  const envSafe = Object.entries(process.env).filter(([k]) => k.startsWith("BROWSERFLOW_") && !/KEY|SECRET|PASSWORD|TOKEN/.test(k)).map(([k, v]) => `${k}=${v}`).join("\n");
  fs.writeFileSync(path.join(dir, "config.env"), envSafe + "\n");
  const migration = await db.execute<{ n: string }>(sql`select count(*)::text as n from information_schema.tables where table_schema='public'`);
  const files: Record<string, string> = {};
  const walk = (d: string) => {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (p !== path.join(dir, "manifest.json")) files[path.relative(dir, p)] = sha256Hex(fs.readFileSync(p));
    }
  };
  walk(dir);
  const manifest = { createdAt: new Date().toISOString(), version: "1.0.0", schemaTables: Number(migration.rows[0]?.n), playwrightVersion: PLAYWRIGHT_VERSION, files, note: "Master key and session secrets are NOT included; store BROWSERFLOW_MASTER_KEY_FILE separately." };
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  out({ ok: true, dir, files: Object.keys(files).length });
}

async function restore(dir: string): Promise<void> {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("manifest.json missing");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { files: Record<string, string>; schemaTables: number };
  for (const [rel, hash] of Object.entries(manifest.files)) {
    const p = path.join(dir, rel);
    if (!fs.existsSync(p) || sha256Hex(fs.readFileSync(p)) !== hash) throw new Error(`Checksum mismatch or missing file: ${rel}`);
  }
  const dryRun = flag("dry-run");
  out({ verified: Object.keys(manifest.files).length, dryRun });
  if (dryRun) return;
  if (!flag("yes")) throw new Error("Restore overwrites the database and data directories. Re-run with --yes to confirm.");
  const st = fs.statfsSync(path.dirname(config.dataDir));
  if (Number(st.bavail) * Number(st.bsize) < 200 * 1024 * 1024) throw new Error("Insufficient disk space for restore");
  const dbUrl = process.env.DATABASE_URL!;
  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-q", "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"], { stdio: "inherit" });
  execFileSync("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-q", "-f", path.join(dir, "database.sql")], { stdio: "inherit" });
  for (const [src, dst] of [["artifacts", config.artifactsDir], ["identities", config.identitiesDir]] as const) {
    fs.rmSync(dst, { recursive: true, force: true });
    if (fs.existsSync(path.join(dir, src))) fs.cpSync(path.join(dir, src), dst, { recursive: true });
  }
  // consistency checks
  const report: Record<string, unknown> = {};
  report.users = (await db.select({ id: users.id }).from(users)).length;
  report.flows = (await db.select({ id: flows.id }).from(flows)).length;
  report.flowVersions = (await db.select({ id: flowVersions.id }).from(flowVersions)).length;
  report.schedules = (await db.select({ id: schedules.id }).from(schedules)).length;
  report.identities = (await db.select({ id: identities.id }).from(identities)).length;
  report.executions = (await db.select({ id: executions.id }).from(executions)).length;
  const creds = await db.select().from(credentials);
  let decrypted = 0;
  for (const c of creds) {
    decryptJson(c.ciphertext, c.id);
    decrypted++;
  }
  report.credentialsDecrypted = `${decrypted}/${creds.length}`;
  const tables = await db.execute<{ n: string }>(sql`select count(*)::text as n from information_schema.tables where table_schema='public'`);
  report.schemaTables = Number(tables.rows[0]?.n);
  report.schemaMatchesManifest = Number(tables.rows[0]?.n) === manifest.schemaTables;
  out({ ok: true, report });
}

/** Smoke test: template -> publish -> execute inline with the real engine + Chromium -> verify. */
async function smoke(): Promise<number> {
  ensureDirectories();
  const templateId = opt("template") ?? "foreach-data";
  const baseUrl = opt("base-url");
  const t = getTemplate(templateId);
  if (!t) throw new Error(`Unknown template ${templateId}`);
  const def = structuredClone(t.definition);
  if (baseUrl) def.variables.baseUrl = baseUrl;
  const compiled = compileFlow(def);
  if (!compiled.ok || !compiled.compiled) {
    out({ ok: false, diagnostics: compiled.diagnostics });
    return 1;
  }
  const flowId = newId();
  await db.insert(flows).values({ id: flowId, name: `smoke-${templateId}`, draftDefinition: def, draftChecksum: checksumOf(def) });
  const c = compiled.compiled;
  const [v] = await db.insert(flowVersions).values({ id: newId(), flowId, versionNumber: 1, definition: c.definition, compiledPlan: c.plan, flowChecksum: c.flowChecksum, compiledPlanChecksum: c.compiledPlanChecksum, nodeRegistryVersion: c.nodeRegistryVersion }).returning();
  await db.update(flows).set({ currentVersionId: v.id }).where(eq(flows.id, flowId));
  const ex = await createExecution({ flowId, triggerType: "manual", actor: { kind: "system" } });
  const workerId = `smoke-${process.pid}`;
  const bs = await browserSelfCheck();
  await registerWorker({ workerId, hostname: "smoke", pid: process.pid, capacity: 1, capabilities: ["browser", "network", "filesystem"], playwrightVersion: PLAYWRIGHT_VERSION, browserVersion: bs.version, browserHealthy: bs.ok });
  const started = Date.now();
  let work = await acquireLease(workerId, ["browser", "network", "filesystem"]);
  while (work && work.execution.id !== ex.id) {
    // another queued execution got leased first; run it too (keeps queue semantics honest)
    await runExecution(work, { isDraining: () => false });
    work = await acquireLease(workerId, ["browser", "network", "filesystem"]);
  }
  if (!work) throw new Error("Could not lease smoke execution");
  await runExecution(work, { isDraining: () => false });
  const snap = await getExecutionSnapshot(ex.id);
  const summary = { ok: snap.execution.status === "SUCCEEDED", executionId: ex.id, status: snap.execution.status, output: snap.execution.output, errorCode: snap.execution.errorCode, errorMessage: snap.execution.errorMessage, nodes: snap.nodes.map((n) => `${n.nodeId}:${n.status}`), artifacts: snap.artifacts.length, events: snap.lastSequence, durationMs: Date.now() - started, browserVersion: snap.execution.browserVersion };
  out(summary);
  if (!flag("keep")) await db.delete(flows).where(eq(flows.id, flowId));
  return summary.ok ? 0 : 1;
}

async function main(): Promise<number> {
  const positional = argv.filter((a) => !a.startsWith("--") && a !== opt("template") && a !== opt("base-url") && a !== opt("batch") && a !== opt("dir"));
  const cmd = positional[0];
  const sub = cmd === "admin" ? positional[1] : undefined;
  const rest = cmd === "admin" ? positional.slice(2) : positional.slice(1);
  switch (`${cmd ?? ""} ${sub ?? ""}`.trim()) {
    case "admin create": {
      const u = await createAdmin(rest[0], rest[1], { allowIfInitialized: flag("force") });
      out({ created: u.email });
      return 0;
    }
    case "admin reset-password":
      await resetPassword(rest[0], rest[1]);
      out({ reset: rest[0] });
      return 0;
    case "doctor":
      return doctor();
    case "cleanup":
      out(await runCleanup({ dryRun: flag("dry-run"), batch: Number(opt("batch") ?? 500) }));
      return 0;
    case "backup":
      await backup(rest[0] ?? opt("dir") ?? `backups/${new Date().toISOString().replace(/[:.]/g, "-")}`);
      return 0;
    case "restore":
      await restore(rest[0] ?? opt("dir") ?? "");
      return 0;
    case "smoke":
      return smoke();
    default:
      out("Usage: browserflow <admin create <email> <password> | admin reset-password <email> <password> | doctor | cleanup [--dry-run] | backup <dir> | restore <dir> [--dry-run|--yes] | smoke [--template id] [--base-url url]>");
      return 2;
  }
}

main()
  .then(async (code) => {
    await pool.end().catch(() => undefined);
    process.exit(code);
  })
  .catch(async (e) => {
    process.stderr.write(`error: ${(e as Error).message}\n`);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
