import argon2 from "argon2";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditEvents, userSessions, users } from "@/db/schema";
import { config } from "@/core/config";
import { errors, newId, randomToken, safeEqual, sha256Hex } from "@/core/security";
import { logger } from "@/core/logger";

export const SESSION_COOKIE = "bf_session";
export const CSRF_HEADER = "x-csrf-token";
const ARGON_OPTS = { type: 2 as const, memoryCost: 65536, timeCost: 3, parallelism: 1 };

export interface AuthUser {
  id: string;
  email: string;
}
export interface SessionInfo {
  user: AuthUser;
  sessionId: string;
  csrfToken: string;
  mode: "authenticated" | "local-only";
}

export async function audit(action: string, outcome: "success" | "failure", params: { userId?: string | null; target?: string | null; ip?: string | null; metadata?: Record<string, unknown> } = {}): Promise<void> {
  await db.insert(auditEvents).values({ id: newId(), action, outcome, userId: params.userId ?? null, target: params.target ?? null, ip: params.ip ?? null, metadata: params.metadata ?? {} });
}

export async function isInitialized(): Promise<boolean> {
  const [r] = await db.select({ n: count() }).from(users);
  return Number(r?.n ?? 0) > 0;
}

function validatePassword(password: string): void {
  if (typeof password !== "string" || password.length < 12 || password.length > 256) throw errors.auth("WEAK_PASSWORD", "Password must be between 12 and 256 characters", 400);
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(password)).length;
  if (classes < 3) throw errors.auth("WEAK_PASSWORD", "Password must include at least three of: lowercase, uppercase, digit, symbol", 400);
}

export async function createAdmin(email: string, password: string, opts: { allowIfInitialized?: boolean } = {}): Promise<AuthUser> {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw errors.auth("INVALID_EMAIL", "Invalid email address", 400);
  validatePassword(password);
  if (!opts.allowIfInitialized && (await isInitialized())) throw errors.auth("ALREADY_INITIALIZED", "Administrator already initialized", 409);
  const passwordHash = await argon2.hash(password, ARGON_OPTS);
  const [u] = await db.insert(users).values({ id: newId(), email: email.toLowerCase(), passwordHash }).returning({ id: users.id, email: users.email });
  await audit("admin.create", "success", { userId: u.id });
  return u;
}

export async function resetPassword(email: string, password: string): Promise<void> {
  validatePassword(password);
  const passwordHash = await argon2.hash(password, ARGON_OPTS);
  const [u] = await db.update(users).set({ passwordHash, updatedAt: new Date(), version: sql`${users.version} + 1` }).where(eq(users.email, email.toLowerCase())).returning({ id: users.id });
  if (!u) throw errors.auth("USER_NOT_FOUND", "User not found", 404);
  await db.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, u.id), isNull(userSessions.revokedAt)));
  await audit("admin.reset-password", "success", { userId: u.id });
}

async function loginRateLimited(ip: string): Promise<boolean> {
  const since = new Date(Date.now() - config.loginWindowSec * 1000);
  const [r] = await db.select({ n: count() }).from(auditEvents).where(and(eq(auditEvents.action, "auth.login"), eq(auditEvents.outcome, "failure"), eq(auditEvents.ip, ip), gt(auditEvents.createdAt, since)));
  return Number(r?.n ?? 0) >= config.loginMaxAttempts;
}

export async function login(email: string, password: string, meta: { ip: string; userAgent: string }): Promise<{ token: string; session: SessionInfo; expiresAt: Date }> {
  if (await loginRateLimited(meta.ip)) {
    await audit("auth.login", "failure", { ip: meta.ip, metadata: { reason: "rate_limited" } });
    throw errors.auth("RATE_LIMITED", "Too many failed login attempts; try again later", 429);
  }
  const [u] = await db.select().from(users).where(eq(users.email, (email ?? "").toLowerCase())).limit(1);
  const valid = u ? await argon2.verify(u.passwordHash, password ?? "").catch(() => false) : await argon2.hash("timing-equalizer", ARGON_OPTS).then(() => false);
  if (!u || !valid) {
    await audit("auth.login", "failure", { ip: meta.ip, metadata: { reason: "invalid_credentials" } });
    throw errors.auth("INVALID_CREDENTIALS", "Invalid email or password", 401);
  }
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000);
  const sessionId = newId();
  await db.insert(userSessions).values({ id: sessionId, userId: u.id, tokenHash: sha256Hex(token), csrfToken, expiresAt, ip: meta.ip, userAgent: meta.userAgent.slice(0, 300) });
  await audit("auth.login", "success", { userId: u.id, ip: meta.ip });
  return { token, expiresAt, session: { user: { id: u.id, email: u.email }, sessionId, csrfToken, mode: "authenticated" } };
}

export async function getSessionByToken(token: string | undefined): Promise<SessionInfo | null> {
  if (!token) return null;
  const rows = await db
    .select({ id: userSessions.id, csrfToken: userSessions.csrfToken, expiresAt: userSessions.expiresAt, revokedAt: userSessions.revokedAt, userId: users.id, email: users.email, lastSeenAt: userSessions.lastSeenAt })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(eq(userSessions.tokenHash, sha256Hex(token)))
    .limit(1);
  const s = rows[0];
  if (!s || s.revokedAt || s.expiresAt.getTime() < Date.now()) return null;
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) await db.update(userSessions).set({ lastSeenAt: new Date() }).where(eq(userSessions.id, s.id));
  return { user: { id: s.userId, email: s.email }, sessionId: s.id, csrfToken: s.csrfToken, mode: "authenticated" };
}

export async function logout(sessionId: string): Promise<void> {
  await db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, sessionId));
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, keepSessionId: string): Promise<void> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !(await argon2.verify(u.passwordHash, currentPassword ?? "").catch(() => false))) {
    await audit("auth.change-password", "failure", { userId });
    throw errors.auth("INVALID_CREDENTIALS", "Current password is incorrect", 401);
  }
  validatePassword(newPassword);
  const passwordHash = await argon2.hash(newPassword, ARGON_OPTS);
  await db.update(users).set({ passwordHash, updatedAt: new Date(), version: sql`${users.version} + 1` }).where(eq(users.id, userId));
  await db.update(userSessions).set({ revokedAt: new Date() }).where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), sql`${userSessions.id} <> ${keepSessionId}`));
  await audit("auth.change-password", "success", { userId });
}

export function verifyCsrf(session: SessionInfo, headerValue: string | null): void {
  if (session.mode === "local-only") return;
  if (!headerValue || !safeEqual(headerValue, session.csrfToken)) throw errors.auth("CSRF", "Missing or invalid CSRF token", 403);
}

export function sessionCookie(token: string, expiresAt: Date): string {
  const parts = [`${SESSION_COOKIE}=${token}`, "Path=/", "HttpOnly", "SameSite=Strict", `Expires=${expiresAt.toUTCString()}`];
  if (config.secureCookies) parts.push("Secure");
  return parts.join("; ");
}
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.secureCookies ? "; Secure" : ""}`;
}

export function localOnlySession(): SessionInfo | null {
  if (config.authMode !== "local-only") return null;
  logger.debug("local-only auth mode in use");
  return { user: { id: "local", email: "local@localhost" }, sessionId: "local", csrfToken: "", mode: "local-only" };
}
