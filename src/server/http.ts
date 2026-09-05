import { z } from "zod";
import { CSRF_HEADER, SESSION_COOKIE, getSessionByToken, localOnlySession, verifyCsrf, type SessionInfo } from "@/auth/service";
import { BFError } from "@/core/security";
import { config } from "@/core/config";
import { logger } from "@/core/logger";

export interface Ctx {
  req: Request;
  url: URL;
  params: Record<string, string>;
  session: SessionInfo | null;
  ip: string;
  body<T>(schema: z.ZodType<T>): Promise<T>;
}
export type Handler = (ctx: Ctx) => Promise<Response>;
interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  isPublic: boolean;
}
const routes: Route[] = [];

export function route(method: string, path: string, handler: Handler, opts: { isPublic?: boolean } = {}): void {
  const keys: string[] = [];
  const pattern = new RegExp("^" + path.replace(/\//g, "\\/").replace(/:([A-Za-z]+)/g, (_m, k: string) => {
    keys.push(k);
    return "([^\\/]+)";
  }) + "\\/?$");
  routes.push({ method, pattern, keys, handler, isPublic: opts.isPublic ?? false });
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

function securityHeaders(res: Response): Response {
  const h = new Headers(res.headers);
  h.set("x-content-type-options", "nosniff");
  h.set("x-frame-options", "DENY");
  h.set("referrer-policy", "no-referrer");
  h.set("cache-control", h.get("cache-control") ?? "no-store");
  h.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function resolveSession(req: Request): Promise<SessionInfo | null> {
  const local = localOnlySession();
  if (local) return local;
  return getSessionByToken(parseCookies(req)[SESSION_COOKIE]);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin || !config.corsOrigins.includes(origin)) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-credentials": "true", "access-control-allow-headers": `content-type, ${CSRF_HEADER}`, "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS", vary: "origin" };
}

export function isAllowedOrigin(req: Request, url: URL): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  if (origin === url.origin) return true;
  if (config.corsOrigins.includes(origin)) return true;
  try {
    const originUrl = new URL(origin);
    const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
    if (forwardedHost) {
      const hostWithoutPort = forwardedHost.split(":")[0];
      if (originUrl.host === forwardedHost || originUrl.hostname === hostWithoutPort) {
        return true;
      }
    }
  } catch {}
  return false;
}

export async function dispatch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/api/, "") || "/";
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "127.0.0.1";
  try {
    let methodMismatch = false;
    for (const r of routes) {
      const m = r.pattern.exec(path);
      if (!m) continue;
      if (r.method !== req.method) {
        methodMismatch = true;
        continue;
      }
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const session = await resolveSession(req);
      if (!r.isPublic) {
        if (!session) throw new BFError("AUTH", "UNAUTHENTICATED", "Authentication required", 401);
        if (!["GET", "HEAD"].includes(req.method)) {
          // CSRF: same-site strict cookie + explicit header token; also reject cross-origin browsers
          if (!isAllowedOrigin(req, url)) throw new BFError("AUTH", "ORIGIN", "Cross-origin request rejected", 403);
          verifyCsrf(session, req.headers.get(CSRF_HEADER));
        }
      }
      const ctx: Ctx = {
        req,
        url,
        params,
        session,
        ip,
        body: async <T>(schema: z.ZodType<T>) => {
          let raw: unknown;
          try {
            raw = await req.json();
          } catch {
            throw new BFError("SYSTEM", "INVALID_JSON", "Request body must be valid JSON", 400);
          }
          const parsed = schema.safeParse(raw);
          if (!parsed.success) throw new BFError("SYSTEM", "VALIDATION", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
          return parsed.data;
        },
      };
      const res = await r.handler(ctx);
      const withCors = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) withCors.set(k, v);
      return securityHeaders(new Response(res.body, { status: res.status, headers: withCors }));
    }
    return securityHeaders(json({ error: { code: methodMismatch ? "BF-SYSTEM-METHOD" : "BF-SYSTEM-NOT_FOUND", message: methodMismatch ? "Method not allowed" : "Not found" } }, methodMismatch ? 405 : 404));
  } catch (e) {
    if (e instanceof BFError) {
      return securityHeaders(json({ error: { code: e.code, message: e.message, details: e.details ?? null } }, e.httpStatus, cors));
    }
    logger.error("unhandled API error", { path, err: (e as Error).message });
    return securityHeaders(json({ error: { code: "BF-SYSTEM-INTERNAL", message: "Internal server error" } }, 500, cors));
  }
}
