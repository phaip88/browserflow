import { config } from "./config";

export type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: number = LEVELS[(process.env.BROWSERFLOW_LOG_LEVEL as LogLevel) || "info"] ?? 20;

const SENSITIVE_KEY = /(password|passwd|token|cookie|authorization|proxy[-_]?pass|credential|session|api[-_]?key|secret|private|set-cookie|x-api-key)/i;
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /(Bearer\s+)[A-Za-z0-9\-_.=]+/gi,
  /(authorization\s*[:=]\s*)[^\s,;]+/gi,
  /(password\s*[:=]\s*)[^\s,;&]+/gi,
  /(token\s*[:=]\s*)[^\s,;&]+/gi,
  /(api[-_]?key\s*[:=]\s*)[^\s,;&]+/gi,
  /(secret\s*[:=]\s*)[^\s,;&]+/gi,
  /(cookie\s*[:=]\s*)[^\n]+/gi,
];

export const REDACTED = "[REDACTED]";

/** Redacts secrets from arbitrary JSON-compatible values by key name and value pattern. */
export function redact<T>(value: T, depth = 0): T {
  if (depth > 12) return REDACTED as unknown as T;
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    let s: string = value;
    for (const p of SENSITIVE_VALUE_PATTERNS) s = s.replace(p, `$1${REDACTED}`);
    return s as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/** Explicit secret registry used by the SecretResolver so resolved values never leak into logs/events. */
const knownSecrets = new Set<string>();
export function registerSecretValue(v: string): void {
  if (v && v.length >= 4) knownSecrets.add(v);
}
export function scrubKnownSecrets<T>(value: T): T {
  if (knownSecrets.size === 0) return value;
  const json = JSON.stringify(value);
  if (json === undefined) return value;
  let out = json;
  for (const s of knownSecrets) {
    const escaped = JSON.stringify(s).slice(1, -1);
    if (escaped.length >= 4) out = out.split(escaped).join(REDACTED);
  }
  return JSON.parse(out) as T;
}

export interface LogContext {
  execution_id?: string;
  attempt_id?: string;
  flow_id?: string;
  flow_version_id?: string;
  node_id?: string;
  worker_id?: string;
  trace_id?: string;
  error_code?: string;
  [k: string]: unknown;
}

function emit(level: LogLevel, msg: string, ctx?: LogContext): void {
  if (LEVELS[level] < minLevel) return;
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: config.serviceName,
    safe_message: redact(msg),
    ...(ctx ? scrubKnownSecrets(redact(ctx)) : {}),
  };
  const line = JSON.stringify(record);
  if (level === "error" || level === "warn") process.stderr.write(line + "\n");
  else process.stdout.write(line + "\n");
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => emit("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => emit("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => emit("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => emit("error", msg, ctx),
  child: (base: LogContext) => ({
    debug: (msg: string, ctx?: LogContext) => emit("debug", msg, { ...base, ...ctx }),
    info: (msg: string, ctx?: LogContext) => emit("info", msg, { ...base, ...ctx }),
    warn: (msg: string, ctx?: LogContext) => emit("warn", msg, { ...base, ...ctx }),
    error: (msg: string, ctx?: LogContext) => emit("error", msg, { ...base, ...ctx }),
  }),
};
export type Logger = ReturnType<typeof logger.child>;
