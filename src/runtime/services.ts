import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull, lt, or, sql, sum, count } from "drizzle-orm";
import { db } from "@/db";
import { artifacts, credentials, identities } from "@/db/schema";
import { config } from "@/core/config";
import { decryptJson, encryptJson, errors, newId, resolveSafePath, sanitizeFilename, sha256Hex } from "@/core/security";
import { registerSecretValue } from "@/core/logger";
import { CREDENTIAL_REF_RE } from "@/flow/schema";
import { recordArtifact, type LeaseIdentity } from "@/execution/service";

// ---------------- Artifacts (LocalArtifactStorage) ----------------
export function executionArtifactRoot(executionId: string): string {
  if (!/^[0-9a-f-]{36}$/.test(executionId)) throw errors.file("INVALID_EXECUTION_ID", "Invalid execution id");
  const dir = path.join(config.artifactsDir, executionId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function checkDiskSpace(dir: string, needed: number): Promise<void> {
  const st = await fs.promises.statfs(dir);
  const free = Number(st.bavail) * Number(st.bsize);
  if (free < needed + 100 * 1024 * 1024) throw errors.file("DISK_FULL", "Insufficient disk space for artifact", 507);
}

export class ArtifactService {
  constructor(private readonly lease: LeaseIdentity) {}

  async write(params: { nodeId?: string; kind: "screenshot" | "file" | "download"; filename: string; data: Buffer; contentType: string }): Promise<{ id: string; relativePath: string; sizeBytes: number; sha256: string }> {
    if (params.data.length > config.limits.maxArtifactBytes) throw errors.file("ARTIFACT_TOO_LARGE", `Artifact exceeds ${config.limits.maxArtifactBytes} bytes`, 413);
    const [agg] = await db.select({ n: count(), bytes: sum(artifacts.sizeBytes) }).from(artifacts).where(eq(artifacts.executionId, this.lease.executionId));
    if (Number(agg?.n ?? 0) >= config.limits.maxArtifactsPerExecution) throw errors.file("ARTIFACT_QUOTA", "Artifact count quota exceeded for execution", 429);
    if (Number(agg?.bytes ?? 0) + params.data.length > config.limits.maxExecutionArtifactBytes) throw errors.file("ARTIFACT_QUOTA", "Artifact byte quota exceeded for execution", 429);
    const [total] = await db.select({ bytes: sum(artifacts.sizeBytes) }).from(artifacts);
    if (Number(total?.bytes ?? 0) + params.data.length > config.limits.maxTotalArtifactBytes) throw errors.file("STORAGE_QUOTA", "Total artifact storage quota exceeded", 507);
    const root = executionArtifactRoot(this.lease.executionId);
    await checkDiskSpace(root, params.data.length);
    const id = newId();
    const safeName = sanitizeFilename(params.filename);
    const rel = `${params.kind}/${id.slice(0, 8)}-${safeName}`;
    const abs = resolveSafePath(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    await fs.promises.writeFile(abs, params.data, { flag: "wx", mode: 0o640 }); // never overwrite
    const digest = sha256Hex(params.data);
    const relativePath = `${this.lease.executionId}/${rel}`;
    const ok = await recordArtifact(this.lease, { id, nodeId: params.nodeId, kind: params.kind, filename: safeName, relativePath, contentType: params.contentType, sizeBytes: params.data.length, sha256: digest });
    if (!ok) {
      await fs.promises.rm(abs, { force: true });
      throw errors.worker("LEASE_LOST", "Lease lost while writing artifact");
    }
    return { id, relativePath, sizeBytes: params.data.length, sha256: digest };
  }

  /** Reads a file previously written inside this execution's sandbox (cross-execution access is impossible by construction). */
  async readText(relative: string, maxBytes = config.limits.maxArtifactBytes): Promise<{ content: string; sizeBytes: number }> {
    const root = executionArtifactRoot(this.lease.executionId);
    const abs = resolveSafePath(root, relative.startsWith("file/") || relative.startsWith("screenshot/") || relative.startsWith("download/") ? relative : `file/${relative}`);
    let target = abs;
    if (!fs.existsSync(target)) {
      // allow lookup by original filename within file/ (ids are prefixed)
      const dir = path.dirname(abs);
      const base = path.basename(abs);
      const match = fs.existsSync(dir) ? fs.readdirSync(dir).find((f) => f.endsWith(`-${base}`)) : undefined;
      if (!match) throw errors.file("NOT_FOUND", `File ${relative} not found in execution sandbox`, 404);
      target = path.join(dir, match);
    }
    const st = await fs.promises.stat(target);
    if (st.size > maxBytes) throw errors.file("FILE_TOO_LARGE", "File exceeds read limit", 413);
    const content = await fs.promises.readFile(target, "utf8");
    return { content, sizeBytes: st.size };
  }
}

export function resolveArtifactAbsolutePath(relativePath: string): string {
  return resolveSafePath(config.artifactsDir, relativePath);
}

// ---------------- Credentials ----------------
export type CredentialFields = Record<string, string>;

export async function createCredential(params: { name: string; kind: string; fields: CredentialFields }) {
  const id = newId();
  const fieldNames = Object.keys(params.fields);
  if (fieldNames.length === 0) throw errors.credential("EMPTY", "Credential must have at least one field");
  for (const k of fieldNames) if (!/^[A-Za-z0-9_-]{1,64}$/.test(k)) throw errors.credential("FIELD_NAME", `Invalid field name ${k}`);
  const ciphertext = encryptJson(params.fields, id);
  const [row] = await db.insert(credentials).values({ id, name: params.name, kind: params.kind, fieldNames, ciphertext }).returning({ id: credentials.id, name: credentials.name, kind: credentials.kind, fieldNames: credentials.fieldNames, createdAt: credentials.createdAt });
  return row;
}
export async function updateCredential(id: string, params: { name?: string; fields?: CredentialFields }) {
  const [existing] = await db.select().from(credentials).where(eq(credentials.id, id)).limit(1);
  if (!existing) throw errors.credential("NOT_FOUND", "Credential not found", 404);
  const patch: Partial<typeof credentials.$inferInsert> = { updatedAt: new Date(), version: existing.version + 1 };
  if (params.name) patch.name = params.name;
  if (params.fields) {
    const current = decryptJson<CredentialFields>(existing.ciphertext, id);
    const merged = { ...current, ...params.fields };
    patch.fieldNames = Object.keys(merged);
    patch.ciphertext = encryptJson(merged, id);
  }
  const [row] = await db.update(credentials).set(patch).where(and(eq(credentials.id, id), eq(credentials.version, existing.version))).returning({ id: credentials.id, name: credentials.name, kind: credentials.kind, fieldNames: credentials.fieldNames, updatedAt: credentials.updatedAt });
  if (!row) throw errors.credential("CONFLICT", "Credential was modified concurrently", 409);
  return row;
}

/** Resolves credential:<id>#<field> references lazily, only when a node is about to execute. */
export class SecretResolver {
  private cache = new Map<string, CredentialFields>();
  private async fields(credId: string): Promise<CredentialFields> {
    const cached = this.cache.get(credId);
    if (cached) return cached;
    const [row] = await db.select().from(credentials).where(or(eq(credentials.id, credId), eq(credentials.name, credId))).limit(1);
    if (!row) throw errors.credential("NOT_FOUND", `Credential ${credId} not found`, 404);
    const f = decryptJson<CredentialFields>(row.ciphertext, row.id);
    for (const v of Object.values(f)) registerSecretValue(v);
    this.cache.set(credId, f);
    return f;
  }
  isRef(value: unknown): boolean {
    return typeof value === "string" && CREDENTIAL_REF_RE.test(value.trim());
  }
  /** Returns the secret value and marks it so it never reaches events/logs. */
  async resolve(value: string): Promise<{ value: string; secret: true }> {
    const m = value.trim().match(CREDENTIAL_REF_RE)!;
    const f = await this.fields(m[1]);
    const field = m[2] ?? (Object.keys(f).length === 1 ? Object.keys(f)[0] : "password");
    if (!(field in f)) throw errors.credential("FIELD_NOT_FOUND", `Credential field ${field} not found`, 404);
    return { value: f[field], secret: true };
  }
  clear(): void {
    this.cache.clear();
  }
}

// ---------------- Identities ----------------
export function identityDirs(identityId: string) {
  if (!/^[0-9a-f-]{36}$/.test(identityId)) throw errors.file("INVALID_IDENTITY_ID", "Invalid identity id");
  const root = path.join(config.identitiesDir, identityId);
  const dirs = { root, profile: path.join(root, "profile"), downloads: path.join(root, "downloads"), artifacts: path.join(root, "artifacts") };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  return dirs;
}

/** Exclusive identity lock: DB row lock + lock file. Expired locks are recoverable. */
export async function acquireIdentityLock(identityId: string, executionId: string, token: string, ttlMs: number): Promise<boolean> {
  const [row] = await db
    .update(identities)
    .set({ lockedByExecutionId: executionId, lockToken: token, lockExpiresAt: sql`now() + make_interval(secs => ${ttlMs / 1000})`, updatedAt: new Date() })
    .where(and(eq(identities.id, identityId), or(isNull(identities.lockedByExecutionId), eq(identities.lockedByExecutionId, executionId), lt(identities.lockExpiresAt, sql`now()`))))
    .returning({ id: identities.id });
  if (!row) return false;
  const dirs = identityDirs(identityId);
  const lockFile = path.join(dirs.root, "profile.lock");
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ executionId, token, pid: process.pid, at: new Date().toISOString() }), { flag: "wx" });
  } catch {
    // DB is authoritative: a stale file from a crashed worker is overwritten once the DB lock is ours.
    fs.writeFileSync(lockFile, JSON.stringify({ executionId, token, pid: process.pid, at: new Date().toISOString(), recovered: true }));
  }
  return true;
}
export async function renewIdentityLock(identityId: string, executionId: string, token: string, ttlMs: number): Promise<boolean> {
  const [row] = await db
    .update(identities)
    .set({ lockExpiresAt: sql`now() + make_interval(secs => ${ttlMs / 1000})` })
    .where(and(eq(identities.id, identityId), eq(identities.lockedByExecutionId, executionId), eq(identities.lockToken, token)))
    .returning({ id: identities.id });
  return Boolean(row);
}
export async function releaseIdentityLock(identityId: string, executionId: string, token: string): Promise<void> {
  await db.update(identities).set({ lockedByExecutionId: null, lockToken: null, lockExpiresAt: null, lastUsedAt: new Date() }).where(and(eq(identities.id, identityId), eq(identities.lockedByExecutionId, executionId), eq(identities.lockToken, token)));
  try {
    fs.rmSync(path.join(identityDirs(identityId).root, "profile.lock"), { force: true });
  } catch {
    /* lock file already gone */
  }
}
