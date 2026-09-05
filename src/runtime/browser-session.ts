import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "playwright";
import { config } from "@/core/config";
import { errors } from "@/core/security";
import { browserRequestPolicy } from "@/core/network-policy";
import { logger, type Logger } from "@/core/logger";

function readPlaywrightVersion(): string {
  try {
    return (JSON.parse(fs.readFileSync(path.join(process.cwd(), "node_modules", "playwright", "package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "unknown";
  }
}
export const PLAYWRIGHT_VERSION: string = readPlaywrightVersion();

export interface BrowserSessionOptions {
  executionId: string;
  profileDir?: string; // persistent identity profile
  runtimeDir: string; // runtime/executions/<id>
  viewport?: { width: number; height: number };
  log: Logger;
}

export interface BlockedRequest {
  url: string;
  reason: string;
  at: string;
}

/**
 * Owns the Chromium process for one execution: launch, context, page registry, network policy
 * interception (page resources, iframes, popups, redirects, websockets), crash detection and cleanup.
 */
export class BrowserSession {
  readonly pages: Page[] = [];
  readonly blocked: BlockedRequest[] = [];
  crashed = false;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private closed = false;
  readonly downloadsDir: string;
  readonly tempDir: string;
  readonly persistent: boolean;

  private constructor(private readonly opts: BrowserSessionOptions) {
    this.downloadsDir = path.join(opts.runtimeDir, "downloads");
    this.tempDir = path.join(opts.runtimeDir, "temp");
    this.persistent = Boolean(opts.profileDir);
  }

  static async launch(opts: BrowserSessionOptions): Promise<BrowserSession> {
    const s = new BrowserSession(opts);
    fs.mkdirSync(s.downloadsDir, { recursive: true });
    fs.mkdirSync(s.tempDir, { recursive: true });
    const args = [
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      `--js-flags=--max-old-space-size=${Math.floor(config.limits.browserMemoryMb / 2)}`,
    ];
    if (config.worker.chromiumNoSandbox) args.push("--no-sandbox");
    const common = { headless: true, args, acceptDownloads: true, downloadsPath: s.downloadsDir, viewport: opts.viewport ?? { width: 1280, height: 800 }, timeout: 60_000 };
    try {
      const { chromium } = await import("playwright");
      if (opts.profileDir) {
        fs.mkdirSync(opts.profileDir, { recursive: true });
        s.context = await chromium.launchPersistentContext(opts.profileDir, common);
        s.browser = s.context.browser();
      } else {
        s.browser = await chromium.launch(common);
        s.context = await s.browser.newContext({ viewport: common.viewport, acceptDownloads: true });
      }
    } catch (e) {
      throw errors.browser("LAUNCH_FAILED", `Chromium launch failed: ${(e as Error).message.split("\n")[0]}`);
    }
    await s.installPolicy();
    s.browser?.on("disconnected", () => {
      if (!s.closed) {
        s.crashed = true;
        opts.log.error("browser disconnected unexpectedly", { error_code: "BF-BROWSER-CRASH" });
      }
    });
    s.context.on("page", (p) => s.registerPage(p));
    for (const p of s.context.pages()) s.registerPage(p);
    if (s.pages.length === 0) await s.context.newPage();
    return s;
  }

  private async installPolicy(): Promise<void> {
    const ctx = this.context!;
    await ctx.route("**/*", async (route) => {
      const url = route.request().url();
      const decision = browserRequestPolicy.decide(url);
      if (!decision.allowed) {
        this.blocked.push({ url: url.slice(0, 200), reason: decision.reason ?? "blocked", at: new Date().toISOString() });
        this.opts.log.warn("browser request blocked by network policy", { url: url.slice(0, 200), error_code: "BF-NETWORK-BLOCKED" });
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });
    await ctx.routeWebSocket("**", (ws) => {
      const decision = browserRequestPolicy.decide(ws.url());
      if (!decision.allowed) {
        this.blocked.push({ url: ws.url().slice(0, 200), reason: decision.reason ?? "blocked", at: new Date().toISOString() });
        ws.close({ code: 1008, reason: "blocked by policy" });
        return;
      }
      ws.connectToServer();
    });
    ctx.setDefaultTimeout(config.limits.nodeTimeoutMs);
  }

  private registerPage(p: Page): void {
    if (this.pages.includes(p)) return;
    if (this.pages.length >= config.limits.maxPages) {
      this.opts.log.warn("page limit reached; closing extra page", { error_code: "BF-BROWSER-PAGE_LIMIT" });
      void p.close().catch(() => undefined);
      return;
    }
    this.pages.push(p);
    p.on("crash", () => {
      this.crashed = true;
      this.opts.log.error("page crashed", { error_code: "BF-BROWSER-PAGE_CRASH" });
    });
    p.on("close", () => {
      const i = this.pages.indexOf(p);
      if (i >= 0) this.pages.splice(i, 1);
    });
  }

  get currentPage(): Page {
    const live = this.pages.filter((p) => !p.isClosed());
    if (live.length === 0) throw errors.browser("NO_PAGE", "No open page in browser session");
    return live[live.length - 1];
  }

  async newPage(): Promise<Page> {
    if (this.pages.length >= config.limits.maxPages) throw errors.browser("PAGE_LIMIT", `Page limit ${config.limits.maxPages} reached`);
    return this.context!.newPage();
  }

  browserVersion(): string | null {
    return this.browser?.version() ?? null;
  }

  async screenshot(page?: Page, fullPage = false): Promise<Buffer> {
    const p = page ?? this.currentPage;
    let quality = 70;
    let buf = await p.screenshot({ type: "jpeg", quality, fullPage, timeout: 10_000 });
    while (buf.length > config.limits.maxScreenshotBytes && quality > 20) {
      quality -= 20;
      buf = await p.screenshot({ type: "jpeg", quality, fullPage: false, timeout: 10_000 });
    }
    if (buf.length > config.limits.maxScreenshotBytes) throw errors.browser("SCREENSHOT_TOO_LARGE", "Screenshot exceeds size limit");
    return buf;
  }

  /** Closes context and browser, kills the process if needed, and removes temporary runtime dirs. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const withTimeout = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<void>((r) => setTimeout(r, ms))]);
    try {
      if (this.context) await withTimeout(this.context.close().catch(() => undefined), 8000);
    } finally {
      try {
        if (this.browser && this.browser.isConnected()) await withTimeout(this.browser.close().catch(() => undefined), 8000);
      } finally {
        for (const d of [this.tempDir, this.downloadsDir]) {
          try {
            fs.rmSync(d, { recursive: true, force: true });
          } catch (e) {
            logger.warn("failed to remove runtime dir", { dir: d, err: (e as Error).message });
          }
        }
      }
    }
  }
}

/** Cached periodic self-check used by readiness (never launches per request). */
export async function browserSelfCheck(): Promise<{ ok: boolean; version: string | null; error?: string }> {
  try {
    const b = await chromium.launch({ headless: true, args: config.worker.chromiumNoSandbox ? ["--no-sandbox", "--disable-dev-shm-usage"] : ["--disable-dev-shm-usage"], timeout: 30_000 });
    const v = b.version();
    await b.close();
    return { ok: true, version: v };
  } catch (e) {
    return { ok: false, version: null, error: (e as Error).message.split("\n")[0] };
  }
}
