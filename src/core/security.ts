import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

// ---------- Error codes ----------
export type ErrorDomain = "FLOW" | "NODE" | "BROWSER" | "NETWORK" | "CREDENTIAL" | "FILE" | "SCHEDULER" | "WORKER" | "SYSTEM" | "AUTH";
export class BFError extends Error {
  readonly code: string;
  readonly domain: ErrorDomain;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;
  constructor(domain: ErrorDomain, code: string, message: string, httpStatus = 400, details?: Record<string, unknown>) {
    super(message);
    this.domain = domain;
    this.code = `BF-${domain}-${code}`;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}
export const errors = {
  flow: (code: string, msg: string, status = 400, d?: Record<string, unknown>) => new BFError("FLOW", code, msg, status, d),
  node: (code: string, msg: string, d?: Record<string, unknown>) => new BFError("NODE", code, msg, 400, d),
  browser: (code: string, msg: string, d?: Record<string, unknown>) => new BFError("BROWSER", code, msg, 500, d),
  network: (code: string, msg: string, d?: Record<string, unknown>) => new BFError("NETWORK", code, msg, 403, d),
  credential: (code: string, msg: string, status = 400) => new BFError("CREDENTIAL", code, msg, status),
  file: (code: string, msg: string, status = 400) => new BFError("FILE", code, msg, status),
  scheduler: (code: string, msg: string, status = 400) => new BFError("SCHEDULER", code, msg, status),
  worker: (code: string, msg: string, status = 409) => new BFError("WORKER", code, msg, status),
  system: (code: string, msg: string, status = 500) => new BFError("SYSTEM", code, msg, status),
  auth: (code: string, msg: string, status = 401) => new BFError("AUTH", code, msg, status),
};

// ---------- Master key & authenticated encryption ----------
let cachedKey: Buffer | null = null;
export function loadMasterKey(): Buffer {
  if (cachedKey) return cachedKey;
  if (process.env.BROWSERFLOW_MASTER_KEY) {
    const raw = process.env.BROWSERFLOW_MASTER_KEY.trim();
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) {
      cachedKey = key;
      return key;
    }
  }
  const file = config.masterKeyFile;
  if (!fs.existsSync(file)) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, crypto.randomBytes(32).toString("base64"), { mode: 0o600 });
    } catch {
      const key = crypto.randomBytes(32);
      cachedKey = key;
      return key;
    }
  }
  try {
    const raw = fs.readFileSync(file, "utf8").trim();
    const key = Buffer.from(raw, "base64");
    if (key.length === 32) {
      cachedKey = key;
      return key;
    }
  } catch {
    // fallback
  }
  const key = crypto.randomBytes(32);
  cachedKey = key;
  return key;
}

export interface EncryptedBlob {
  v: 1;
  iv: string;
  tag: string;
  data: string;
}
export function encryptJson(value: unknown, aad: string): string {
  const key = loadMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const blob: EncryptedBlob = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
  return JSON.stringify(blob);
}
export function decryptJson<T = unknown>(serialized: string, aad: string): T {
  const key = loadMasterKey();
  const blob = JSON.parse(serialized) as EncryptedBlob;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(blob.iv, "base64"));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(blob.tag, "base64"));
  try {
    const out = Buffer.concat([decipher.update(Buffer.from(blob.data, "base64")), decipher.final()]);
    return JSON.parse(out.toString("utf8")) as T;
  } catch {
    throw errors.credential("DECRYPT_FAILED", "Credential authentication failed (wrong key or tampered data)", 500);
  }
}

export function sha256Hex(input: string | Buffer): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}
export function newId(): string {
  return crypto.randomUUID();
}
/** Deterministic checksum of JSON (keys sorted recursively). */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = sort((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return JSON.stringify(sort(value));
}
export function checksumOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

// ---------- SafePathResolver ----------
const ILLEGAL_NAME = /[<>:"|?*\u0000-\u001f]/;
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * Resolves a user-provided relative path inside a sandbox root. Rejects traversal,
 * absolute paths, Windows drive/UNC, illegal names, and symlink escapes.
 */
export function resolveSafePath(root: string, relative: string): string {
  if (typeof relative !== "string" || relative.length === 0 || relative.length > 512) {
    throw errors.file("INVALID_PATH", "Path must be a non-empty relative string");
  }
  if (relative.includes("\0")) throw errors.file("INVALID_PATH", "Path contains NUL");
  if (path.isAbsolute(relative) || relative.startsWith("\\") || relative.startsWith("/") || WINDOWS_DRIVE.test(relative) || relative.startsWith("\\\\")) {
    throw errors.file("ABSOLUTE_PATH", "Absolute, drive or UNC paths are not allowed");
  }
  const normalized = relative.replace(/\\/g, "/");
  const segments = normalized.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) throw errors.file("INVALID_PATH", "Empty path");
  for (const seg of segments) {
    if (seg === "." || seg === "..") throw errors.file("PATH_TRAVERSAL", "Path traversal segments are not allowed");
    if (ILLEGAL_NAME.test(seg) || RESERVED.test(seg) || seg.endsWith(" ") || seg.endsWith(".")) {
      throw errors.file("ILLEGAL_NAME", `Illegal path segment: ${seg}`);
    }
  }
  const rootReal = fs.realpathSync(root);
  const resolved = path.resolve(rootReal, ...segments);
  if (!resolved.startsWith(rootReal + path.sep)) throw errors.file("PATH_ESCAPE", "Resolved path escapes sandbox root");
  // Symlink escape: walk existing ancestors and check realpath stays within root.
  let probe = resolved;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const probeReal = fs.realpathSync(probe);
  if (probeReal !== rootReal && !probeReal.startsWith(rootReal + path.sep)) {
    throw errors.file("SYMLINK_ESCAPE", "Path resolves through a symlink outside the sandbox");
  }
  if (fs.existsSync(resolved)) {
    const st = fs.lstatSync(resolved);
    if (st.isSymbolicLink()) throw errors.file("SYMLINK_ESCAPE", "Symlinks are not permitted as targets");
  }
  return resolved;
}

export function sanitizeFilename(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "file";
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "file";
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
