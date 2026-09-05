import crypto from "node:crypto";
import { checkUrlWithDns, checkUrlSyntax, isBlockedIp } from "@/core/network-policy";
import { config } from "@/core/config";
import { errors } from "@/core/security";
import { renderTemplate, requireString, toBoolean, type NodeImpl, type NodeResult } from "./sdk";

const ok = (values: Record<string, unknown>, runtime?: Record<string, unknown>): NodeResult => ({ values, runtime });
const str = (v: unknown, def = ""): string => (v === undefined || v === null ? def : String(v));
const num = (v: unknown, def: number): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : def);

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(errors.flow("CANCELLED", "Cancelled", 409));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(errors.flow("CANCELLED", "Cancelled", 409));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------- control ----------------
const control: Record<string, NodeImpl> = {
  "control.start": async (ctx) => ok({ inputs: ctx.scope.get("inputs") ?? {} }),
  "control.end": async () => ok({}),
  "control.if": async (ctx) => {
    let result = toBoolean(ctx.inputs.condition);
    if (toBoolean(ctx.config.negate)) result = !result;
    return { values: { result }, branch: result ? "TRUE" : "FALSE" };
  },
  "control.foreach": async (ctx) => {
    const raw = ctx.inputs.items;
    let items: unknown[];
    if (Array.isArray(raw)) items = raw;
    else if (typeof raw === "number") items = Array.from({ length: Math.max(0, Math.floor(raw)) }, (_, i) => i);
    else if (raw && typeof raw === "object") items = Object.entries(raw as Record<string, unknown>).map(([key, value]) => ({ key, value }));
    else if (typeof raw === "string") items = raw.split(/\r?\n/).filter((l) => l.length > 0);
    else throw errors.node("INVALID_INPUT", "foreach items must be an array, object, number or newline string");
    const max = Math.min(num(ctx.config.maxIterations, 100), config.limits.maxLoopIterations);
    if (items.length > max) throw errors.node("LOOP_LIMIT", `foreach received ${items.length} items; max is ${max}`);
    return { values: { count: items.length, results: [] }, loopItems: items };
  },
  "control.wait": async (ctx) => {
    const ms = Math.min(Math.max(0, num(ctx.config.ms, 1000)), 300_000);
    await sleep(ms, ctx.cancellation.signal);
    return ok({ waitedMs: ms });
  },
  "control.fail": async (ctx) => ({ values: {}, control: { kind: "fail", message: str(ctx.config.message, "Flow failed") } }),
  "control.return": async (ctx) => ({ values: {}, control: { kind: "return", value: ctx.inputs.value ?? null } }),
};

// ---------------- page ----------------
const page: Record<string, NodeImpl> = {
  "page.goto": async (ctx) => {
    const url = requireString(ctx.inputs.url ?? ctx.config.url, "url");
    await checkUrlWithDns(url);
    const p = ctx.page();
    const waitUntil = (ctx.config.waitUntil as "load" | "domcontentloaded" | "networkidle" | "commit" | undefined) ?? "load";
    const resp = await p.goto(url, { waitUntil, timeout: ctx.timeoutMs });
    if (resp) {
      const remote = await resp.serverAddr().catch(() => null);
      if (remote && isBlockedIp(remote.ipAddress) && !config.network.privateAllowList.includes(remote.ipAddress)) {
        await p.goto("about:blank").catch(() => undefined);
        throw errors.network("IP_BLOCKED", "Navigation reached a blocked address (DNS rebinding protection)");
      }
    }
    return ok({ url: p.url(), status: resp?.status() ?? null }, { page: p });
  },
  "page.reload": async (ctx) => {
    const p = ctx.page();
    await p.reload({ timeout: ctx.timeoutMs });
    return ok({ url: p.url() });
  },
  "page.title": async (ctx) => ok({ title: await ctx.page().title() }),
  "page.url": async (ctx) => ok({ url: ctx.page().url() }),
  "page.screenshot": async (ctx) => {
    const buf = await ctx.browser().screenshot(ctx.page(), toBoolean(ctx.config.fullPage));
    const art = await ctx.artifacts.write({ nodeId: ctx.nodeId, kind: "screenshot", filename: `${str(ctx.config.name, "screenshot")}.jpg`, data: buf, contentType: "image/jpeg" });
    return ok({ artifactId: art.id, sizeBytes: art.sizeBytes });
  },
  "page.waitForURL": async (ctx) => {
    const pattern = requireString(ctx.config.pattern, "pattern");
    const p = ctx.page();
    await p.waitForURL(pattern.includes("*") ? pattern : (u) => u.href.includes(pattern), { timeout: ctx.timeoutMs });
    return ok({ url: p.url() });
  },
  "page.waitForLoadState": async (ctx) => {
    const state = (ctx.config.state as "load" | "domcontentloaded" | "networkidle" | undefined) ?? "load";
    await ctx.page().waitForLoadState(state, { timeout: ctx.timeoutMs });
    return ok({ state });
  },
};

// ---------------- locator ----------------
const locator: Record<string, NodeImpl> = {
  "locator.css": async (ctx) => {
    const parent = ctx.optionalLocator("parent");
    const sel = requireString(ctx.config.selector, "selector");
    const loc = parent ? parent.locator(sel) : ctx.page().locator(sel);
    return ok({}, { locator: loc });
  },
  "locator.text": async (ctx) => {
    const parent = ctx.optionalLocator("parent");
    const text = requireString(ctx.config.text, "text");
    const opts = { exact: toBoolean(ctx.config.exact) };
    return ok({}, { locator: parent ? parent.getByText(text, opts) : ctx.page().getByText(text, opts) });
  },
  "locator.role": async (ctx) => {
    const parent = ctx.optionalLocator("parent");
    const role = requireString(ctx.config.role, "role") as Parameters<import("playwright").Page["getByRole"]>[0];
    const name = ctx.config.name ? str(ctx.config.name) : undefined;
    const opts = { name, exact: toBoolean(ctx.config.exact) };
    return ok({}, { locator: parent ? parent.getByRole(role, opts) : ctx.page().getByRole(role, opts) });
  },
  "locator.first": async (ctx) => ok({}, { locator: ctx.locator().first() }),
  "locator.nth": async (ctx) => ok({}, { locator: ctx.locator().nth(Math.max(0, num(ctx.inputs.index ?? ctx.config.index, 0))) }),
  "locator.count": async (ctx) => ok({ count: await ctx.locator().count() }),
  "locator.waitFor": async (ctx) => {
    await ctx.locator().waitFor({ state: (ctx.config.state as "attached" | "detached" | "visible" | "hidden" | undefined) ?? "visible", timeout: ctx.timeoutMs });
    return ok({ ok: true });
  },
};

// ---------------- element ----------------
const element: Record<string, NodeImpl> = {
  "element.click": async (ctx) => {
    await ctx.locator().click({ button: (ctx.config.button as "left" | "right" | "middle") ?? "left", clickCount: num(ctx.config.clickCount, 1), timeout: ctx.timeoutMs });
    return ok({ clicked: true });
  },
  "element.fill": async (ctx) => {
    const value = str(ctx.inputs.value ?? ctx.config.value);
    await ctx.locator().fill(value, { timeout: ctx.timeoutMs });
    return ok({ filled: true });
  },
  "element.press": async (ctx) => {
    const key = requireString(ctx.config.key, "key");
    await ctx.locator().press(key, { timeout: ctx.timeoutMs });
    return ok({ pressed: key });
  },
  "element.selectOption": async (ctx) => {
    const value = str(ctx.inputs.value ?? ctx.config.value);
    const loc = ctx.locator();
    let selected: string[];
    try {
      selected = await loc.selectOption(value, { timeout: ctx.timeoutMs });
    } catch {
      selected = await loc.selectOption({ label: value }, { timeout: ctx.timeoutMs });
    }
    return ok({ selected });
  },
  "element.check": async (ctx) => {
    const checked = ctx.config.checked === undefined ? true : toBoolean(ctx.config.checked);
    await ctx.locator().setChecked(checked, { timeout: ctx.timeoutMs });
    return ok({ checked });
  },
  "element.innerText": async (ctx) => ok({ text: await ctx.locator().innerText({ timeout: ctx.timeoutMs }) }),
  "element.textContent": async (ctx) => ok({ text: await ctx.locator().textContent({ timeout: ctx.timeoutMs }) }),
  "element.getAttribute": async (ctx) => ok({ value: await ctx.locator().getAttribute(requireString(ctx.config.attribute, "attribute"), { timeout: ctx.timeoutMs }) }),
  "element.isVisible": async (ctx) => ok({ visible: await ctx.locator().isVisible() }),
};

// ---------------- data ----------------
const data: Record<string, NodeImpl> = {
  "data.constant": async (ctx) => ok({ value: ctx.config.value ?? null }),
  "data.setVariable": async (ctx) => {
    const name = requireString(ctx.config.name, "name");
    if (ctx.secretKeys.size > 0 && ctx.secretKeys.has("value")) throw errors.node("SECRET_IN_VALUE", "Secrets cannot be stored in variables");
    if (ctx.config.scope === "current") ctx.scope.set(name, ctx.inputs.value);
    else ctx.scope.setFlow(name, ctx.inputs.value);
    return ok({ value: ctx.inputs.value ?? null });
  },
  "data.getVariable": async (ctx) => {
    const name = requireString(ctx.config.name, "name");
    const v = ctx.scope.get(name);
    return ok({ value: v === undefined ? (ctx.config.default ?? null) : v });
  },
  "data.template": async (ctx) => {
    const tpl = requireString(ctx.config.template, "template");
    const rendered = renderTemplate(tpl, ctx.scope);
    return ok({ text: typeof rendered === "string" ? rendered : JSON.stringify(rendered ?? null) });
  },
  "data.jsonParse": async (ctx) => {
    const text = requireString(ctx.inputs.text, "text");
    try {
      return ok({ value: JSON.parse(text) });
    } catch (e) {
      throw errors.node("JSON_PARSE", `Invalid JSON: ${(e as Error).message}`);
    }
  },
  "data.jsonStringify": async (ctx) => ok({ text: JSON.stringify(ctx.inputs.value ?? null, null, toBoolean(ctx.config.pretty) ? 2 : undefined) }),
  "data.compare": async (ctx) => {
    const left = ctx.inputs.left;
    const right = ctx.inputs.right !== undefined ? ctx.inputs.right : ctx.config.right;
    const op = str(ctx.config.operator, "eq");
    const n = (v: unknown) => Number(v);
    const s = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "string" ? v : JSON.stringify(v));
    let result: boolean;
    switch (op) {
      case "eq": result = s(left) === s(right); break;
      case "neq": result = s(left) !== s(right); break;
      case "gt": result = n(left) > n(right); break;
      case "gte": result = n(left) >= n(right); break;
      case "lt": result = n(left) < n(right); break;
      case "lte": result = n(left) <= n(right); break;
      case "contains": result = Array.isArray(left) ? left.map(s).includes(s(right)) : s(left).includes(s(right)); break;
      case "startsWith": result = s(left).startsWith(s(right)); break;
      case "endsWith": result = s(left).endsWith(s(right)); break;
      case "matches": {
        const pattern = s(right);
        if (pattern.length > 200) throw errors.node("REGEX_TOO_LONG", "Regex pattern too long");
        result = new RegExp(pattern).test(s(left));
        break;
      }
      case "isEmpty": result = left === null || left === undefined || s(left) === "" || (Array.isArray(left) && left.length === 0); break;
      case "isNotEmpty": result = !(left === null || left === undefined || s(left) === "" || (Array.isArray(left) && left.length === 0)); break;
      default: throw errors.node("INVALID_OPERATOR", `Unknown operator ${op}`);
    }
    return ok({ result });
  },
  "data.randomString": async (ctx) => {
    const length = Math.min(256, Math.max(1, num(ctx.config.length, 12)));
    const alphabets: Record<string, string> = { alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", alpha: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", numeric: "0123456789", hex: "0123456789abcdef" };
    const alphabet = alphabets[str(ctx.config.alphabet, "alphanumeric")] ?? alphabets.alphanumeric;
    const bytes = crypto.randomBytes(length);
    let out = "";
    for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
    return ok({ value: out });
  },
};

// ---------------- integration ----------------
async function safeFetch(rawUrl: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal; timeoutMs: number }) {
  let url = rawUrl;
  let redirects = 0;
  const started = Date.now();
  for (;;) {
    const { url: parsed } = await checkUrlWithDns(url);
    const remaining = init.timeoutMs - (Date.now() - started);
    if (remaining <= 0) throw errors.network("TIMEOUT", "HTTP request timed out");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), remaining);
    const onAbort = () => ctrl.abort();
    init.signal.addEventListener("abort", onAbort, { once: true });
    try {
      const res = await fetch(parsed.toString(), { method: init.method, headers: init.headers, body: init.body, redirect: "manual", signal: ctrl.signal });
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        if (!loc) return res;
        if (++redirects > config.limits.maxHttpRedirects) throw errors.network("TOO_MANY_REDIRECTS", "Too many redirects");
        url = new URL(loc, parsed).toString();
        checkUrlSyntax(url);
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && init.method === "POST")) {
          init = { ...init, method: "GET", body: undefined };
        }
        continue;
      }
      return res;
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") throw errors.network("TIMEOUT", "HTTP request aborted or timed out");
      throw e;
    } finally {
      clearTimeout(timer);
      init.signal.removeEventListener("abort", onAbort);
    }
  }
}

const integration: Record<string, NodeImpl> = {
  "integration.httpRequest": async (ctx) => {
    const url = requireString(ctx.inputs.url ?? ctx.config.url, "url");
    const method = str(ctx.config.method, "GET").toUpperCase();
    const headers: Record<string, string> = {};
    const rawHeaders = ctx.config.headers;
    if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
      for (const [k, v] of Object.entries(rawHeaders as Record<string, unknown>)) if (/^[A-Za-z0-9-]+$/.test(k)) headers[k] = str(v);
    }
    if (ctx.config.authorization) headers.authorization = str(ctx.config.authorization);
    let body: string | undefined;
    const bodyInput = ctx.inputs.body ?? ctx.config.body;
    if (bodyInput !== undefined && bodyInput !== null && bodyInput !== "" && !["GET", "HEAD"].includes(method)) {
      if (typeof bodyInput === "string") body = bodyInput;
      else {
        body = JSON.stringify(bodyInput);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) headers["content-type"] = "application/json";
      }
    }
    const res = await safeFetch(url, { method, headers, body, signal: ctx.cancellation.signal, timeoutMs: ctx.timeoutMs });
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > config.limits.maxHttpBodyBytes) throw errors.network("BODY_TOO_LARGE", "Response body exceeds limit");
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > config.limits.maxHttpBodyBytes) {
          await reader.cancel();
          throw errors.network("BODY_TOO_LARGE", "Response body exceeds limit");
        }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (!/set-cookie|authorization/i.test(k)) respHeaders[k] = v;
    });
    let parsedBody: unknown = text;
    if (toBoolean(ctx.config.parseJson ?? true) && /json/i.test(res.headers.get("content-type") ?? "")) {
      try {
        parsedBody = JSON.parse(text);
      } catch {
        parsedBody = text;
      }
    }
    return ok({ status: res.status, headers: respHeaders, body: parsedBody });
  },
  "integration.readFile": async (ctx) => {
    const rel = requireString(ctx.inputs.path ?? ctx.config.path, "path");
    const r = await ctx.artifacts.readText(rel);
    return ok({ content: r.content, sizeBytes: r.sizeBytes });
  },
  "integration.writeFile": async (ctx) => {
    const rel = requireString(ctx.config.path, "path");
    const raw = ctx.inputs.content ?? ctx.config.content ?? "";
    const content = typeof raw === "string" ? raw : JSON.stringify(raw, null, 2);
    if (ctx.secretKeys.has("content")) throw errors.node("SECRET_IN_FILE", "Secrets cannot be written to files");
    const art = await ctx.artifacts.write({ nodeId: ctx.nodeId, kind: "file", filename: rel, data: Buffer.from(content, "utf8"), contentType: str(ctx.config.contentType, "text/plain") });
    return ok({ artifactId: art.id, sizeBytes: art.sizeBytes });
  },
  "integration.notify": async (ctx) => {
    await ctx.notify((ctx.config.level as "info" | "warning" | "error") ?? "info", str(ctx.config.message), ctx.inputs.data);
    return ok({ delivered: true });
  },
};

export const NODE_IMPLEMENTATIONS: Record<string, NodeImpl> = { ...control, ...page, ...locator, ...element, ...data, ...integration };
