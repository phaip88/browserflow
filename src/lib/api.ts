"use client";
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 5_000, refetchOnWindowFocus: false } } });

let csrfToken: string | null = null;
export function setCsrfToken(t: string | null) {
  csrfToken = t;
}
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) {
    super(message);
  }
}
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["content-type"] = "application/json";
  if (csrfToken && init.method && init.method !== "GET") headers["x-csrf-token"] = csrfToken;
  const res = await fetch(`/api${path}`, { method: init.method ?? "GET", headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined, credentials: "same-origin" });
  if (init.raw) return res as unknown as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "BF-SYSTEM-HTTP", err.message ?? `HTTP ${res.status}`, err.details ?? data);
  }
  return data as T;
}
export interface AuthStatus { initialized: boolean; mode: string; authenticated: boolean; user: { id: string; email: string } | null; csrfToken: string | null }
export interface FlowSummary { id: string; name: string; description: string; currentVersionId: string | null; archivedAt: string | null; draftUpdatedAt: string; createdAt: string; updatedAt: string; version: number }
export interface Diagnostic { severity: "ERROR" | "WARNING" | "INFO"; code: string; message: string; nodeId?: string; edgeId?: string; field?: string }
export interface ExecutionRow { id: string; flowId: string; flowName?: string; flowVersionId: string; status: string; triggerType: string; currentNodeId: string | null; errorCode: string | null; errorMessage: string | null; output: unknown; createdAt: string; startedAt: string | null; finishedAt: string | null; attemptCount: number; maxAttempts: number; browserVersion: string | null; playwrightVersion: string | null; eventSequence: number; timeoutMs: number; identityId: string | null; scheduleId: string | null }
export const fmtDate = (d: string | Date | null | undefined) => (d ? new Date(d).toLocaleString() : "—");
export const fmtDuration = (a?: string | null, b?: string | null) => {
  if (!a) return "—";
  const ms = (b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime();
  return ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
};
