import type { Locator, Page } from "playwright";
import type { BrowserSession } from "@/runtime/browser-session";
import type { ArtifactService } from "@/runtime/services";
import type { Logger } from "@/core/logger";
import { TEMPLATE_RE } from "@/flow/schema";
import { errors } from "@/core/security";

/** Scope chain: ExecutionScope -> BranchScope/LoopScope. Reads walk the parent chain; writes stay local unless flow-level. */
export class Scope {
  private readonly vars = new Map<string, unknown>();
  constructor(readonly kind: "execution" | "loop" | "branch", readonly parent: Scope | null, readonly path: string) {}
  get(name: string): unknown {
    if (this.vars.has(name)) return this.vars.get(name);
    return this.parent ? this.parent.get(name) : undefined;
  }
  has(name: string): boolean {
    return this.vars.has(name) || (this.parent ? this.parent.has(name) : false);
  }
  set(name: string, value: unknown): void {
    this.vars.set(name, value);
  }
  setFlow(name: string, value: unknown): void {
    let root: Scope = this;
    while (root.parent) root = root.parent;
    root.vars.set(name, value);
  }
  snapshot(): Record<string, unknown> {
    const out: Record<string, unknown> = this.parent ? this.parent.snapshot() : {};
    for (const [k, v] of this.vars) out[k] = v;
    return out;
  }
  static loop(parent: Scope, item: unknown, index: number, length: number, loopId: string): Scope {
    const s = new Scope("loop", parent, `${parent.path}/${loopId}[${index}]`);
    s.set("item", item);
    s.set("index", index);
    s.set("length", length);
    s.set("first", index === 0);
    s.set("last", index === length - 1);
    return s;
  }
}

export function lookupPath(root: unknown, pathExpr: string): unknown {
  const parts = pathExpr.replace(/\[(\d+)\]/g, ".$1").split(".").filter(Boolean);
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/** Renders {{ path }} placeholders. A string that is exactly one placeholder returns the raw value. */
export function renderTemplate(template: string, scope: Scope): unknown {
  const single = template.trim().match(/^\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+|\[\d+\])*)\s*\}\}$/);
  const resolve = (expr: string): unknown => {
    const [rootName, ...rest] = expr.split(/\.|\[/);
    const rootVal = scope.get(rootName);
    if (rest.length === 0) return rootVal;
    return lookupPath(rootVal, expr.slice(rootName.length));
  };
  if (single) return resolve(single[1]);
  return template.replace(TEMPLATE_RE, (_m, expr: string) => {
    const v = resolve(expr);
    if (v === undefined || v === null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

export type CancellationToken = { readonly signal: AbortSignal; readonly cancelled: boolean; throwIfCancelled(): void };

export interface NodeRunContext {
  executionId: string;
  attemptId: string;
  flowVersionId: string;
  nodeId: string;
  nodeType: string;
  config: Record<string, unknown>;
  inputs: Record<string, unknown>;
  secretKeys: ReadonlySet<string>;
  scope: Scope;
  timeoutMs: number;
  cancellation: CancellationToken;
  artifacts: ArtifactService;
  log: Logger;
  browser(): BrowserSession;
  page(): Page;
  locator(inputName?: string): Locator;
  optionalLocator(inputName?: string): Locator | null;
  notify(level: "info" | "warning" | "error", message: string, data?: unknown): Promise<void>;
  /** Registers a runtime page as the current page. */
  registerPage(page: Page): void;
}

export interface NodeResult {
  values: Record<string, unknown>;
  runtime?: Record<string, unknown>;
  branch?: "TRUE" | "FALSE";
  control?: { kind: "return"; value: unknown } | { kind: "fail"; message: string };
  loopItems?: unknown[];
}

export type NodeImpl = (ctx: NodeRunContext) => Promise<NodeResult>;

export function requireString(v: unknown, name: string): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  throw errors.node("INVALID_INPUT", `${name} must be a string`);
}
export function toBoolean(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return !["", "false", "0", "no", "null", "undefined"].includes(v.trim().toLowerCase());
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}
