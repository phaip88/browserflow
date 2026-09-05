import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isBlockedIp, normalizeIPv4Literal, checkHostSync, checkUrlSyntax, browserRequestPolicy } from "@/core/network-policy";
import { resolveSafePath, sanitizeFilename, encryptJson, decryptJson, checksumOf } from "@/core/security";
import { redact, registerSecretValue, scrubKnownSecrets } from "@/core/logger";
import { canTransition, assertTransition, isTerminal } from "@/execution/core";
import { Scope, renderTemplate, toBoolean } from "@/nodes/sdk";
import { isAllowedOrigin } from "@/server/http";

describe("network policy (SSRF)", () => {
  it("blocks loopback, private, link-local, metadata, CGNAT and IPv6 local", () => {
    for (const ip of ["127.0.0.1", "127.1.2.3", "10.0.0.5", "172.16.5.5", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "224.0.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111"]) expect(isBlockedIp(ip), ip).toBe(false);
  });
  it("normalizes decimal/hex/octal/shorthand IPv4 tricks", () => {
    expect(normalizeIPv4Literal("2130706433")).toBe("127.0.0.1");
    expect(normalizeIPv4Literal("0x7f000001")).toBe("127.0.0.1");
    expect(normalizeIPv4Literal("0177.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIPv4Literal("127.1")).toBe("127.0.0.1");
    expect(isBlockedIp("2130706433")).toBe(true);
    expect(isBlockedIp("0x7f.0.0.1")).toBe(true);
  });
  it("blocks internal hostnames and schemes", () => {
    expect(checkHostSync("localhost").allowed).toBe(false);
    expect(checkHostSync("metadata.google.internal").allowed).toBe(false);
    expect(checkHostSync("postgres").allowed).toBe(false);
    expect(checkHostSync("foo.localhost").allowed).toBe(false);
    expect(checkHostSync("example.com").allowed).toBe(true);
    expect(() => checkUrlSyntax("file:///etc/passwd")).toThrow();
    expect(() => checkUrlSyntax("http://user:pw@example.com")).toThrow();
    expect(browserRequestPolicy.decide("ws://127.0.0.1:9229/").allowed).toBe(false);
    expect(browserRequestPolicy.decide("http://10.0.0.1/").allowed).toBe(false);
    expect(browserRequestPolicy.decide("https://example.com/a.js").allowed).toBe(true);
    expect(browserRequestPolicy.decide("about:blank").allowed).toBe(true);
  });
});

describe("safe path resolver", () => {
  let root: string;
  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "bf-safe-"));
    fs.mkdirSync(path.join(root, "sub"));
    fs.symlinkSync(os.tmpdir(), path.join(root, "escape"));
  });
  it("accepts relative paths inside the root", () => {
    expect(resolveSafePath(root, "sub/file.txt")).toBe(path.join(fs.realpathSync(root), "sub", "file.txt"));
  });
  it("rejects traversal, absolute, drive, UNC, NUL, illegal names and symlink escapes", () => {
    for (const p of ["../x", "sub/../../x", "/etc/passwd", "C:\\Windows\\x", "\\\\server\\share", "a\0b", "con.txt", "bad<name>", "escape/x.txt", ""]) {
      expect(() => resolveSafePath(root, p), p).toThrow();
    }
  });
  it("sanitizes filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("..hidden")).toBe("hidden");
    expect(sanitizeFilename("a b/c d.txt")).toBe("c_d.txt");
  });
});

describe("crypto & redaction", () => {
  it("encrypts/decrypts with AAD binding and detects tampering", () => {
    process.env.BROWSERFLOW_MASTER_KEY_FILE = path.join(os.tmpdir(), `bf-key-${process.pid}`);
    const ct = encryptJson({ password: "s3cret" }, "cred-1");
    expect(ct).not.toContain("s3cret");
    expect(decryptJson<{ password: string }>(ct, "cred-1").password).toBe("s3cret");
    expect(() => decryptJson(ct, "cred-2")).toThrow();
    const blob = JSON.parse(ct);
    blob.data = Buffer.from("xx").toString("base64");
    expect(() => decryptJson(JSON.stringify(blob), "cred-1")).toThrow();
  });
  it("redacts sensitive keys and patterns, and scrubs registered secrets", () => {
    const r = redact({ password: "p", nested: { authorization: "Bearer abc", ok: "fine" }, text: "token=abcdef" }) as Record<string, unknown>;
    expect(r.password).toBe("[REDACTED]");
    expect((r.nested as Record<string, unknown>).authorization).toBe("[REDACTED]");
    expect(r.text).toBe("token=[REDACTED]");
    registerSecretValue("hunter22");
    expect(JSON.stringify(scrubKnownSecrets({ out: "value hunter22 here" }))).not.toContain("hunter22");
  });
  it("produces canonical checksums", () => {
    expect(checksumOf({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(checksumOf({ b: [1, { d: 3, c: 2 }], a: 1 }));
  });
});

describe("state machine", () => {
  it("allows legal and rejects illegal transitions", () => {
    expect(canTransition("QUEUED", "LEASED")).toBe(true);
    expect(canTransition("RUNNING", "SUCCEEDED")).toBe(true);
    expect(canTransition("WORKER_LOST", "QUEUED")).toBe(true);
    expect(canTransition("SUCCEEDED", "RUNNING")).toBe(false);
    expect(canTransition("CANCELLED", "QUEUED")).toBe(false);
    expect(() => assertTransition("FAILED", "RUNNING")).toThrow();
    expect(isTerminal("TIMED_OUT")).toBe(true);
    expect(isTerminal("CANCELLING")).toBe(false);
  });
});

describe("scopes & templates", () => {
  it("resolves through the parent chain and isolates loop scopes", () => {
    const root = new Scope("execution", null, "");
    root.set("name", "root");
    const l1 = Scope.loop(root, "a", 0, 2, "loop");
    const l2 = Scope.loop(root, "b", 1, 2, "loop");
    l1.set("result", "x");
    expect(l1.get("name")).toBe("root");
    expect(l1.get("item")).toBe("a");
    expect(l2.get("item")).toBe("b");
    expect(l2.get("result")).toBeUndefined();
    expect(l1.get("first")).toBe(true);
    expect(l2.get("last")).toBe(true);
    l2.setFlow("shared", 1);
    expect(root.get("shared")).toBe(1);
  });
  it("renders templates safely and preserves types for single placeholders", () => {
    const s = new Scope("execution", null, "");
    s.set("obj", { a: [1, { b: "deep" }] });
    s.set("n", 42);
    expect(renderTemplate("{{n}}", s)).toBe(42);
    expect(renderTemplate("v={{obj.a[1].b}} n={{n}} missing={{nope}}", s)).toBe("v=deep n=42 missing=");
    expect(toBoolean("false")).toBe(false);
    expect(toBoolean([])).toBe(false);
    expect(toBoolean("yes")).toBe(true);
  });
});

describe("CSRF origin validation", () => {
  it("accepts same-origin and proxy-forwarded hosts, rejects cross-origin", () => {
    const url = new URL("http://0.0.0.0:3000/api/flows");

    const reqDirect = new Request("http://0.0.0.0:3000/api/flows", {
      headers: { origin: "http://0.0.0.0:3000" },
    });
    expect(isAllowedOrigin(reqDirect, url)).toBe(true);

    const reqProxy = new Request("http://0.0.0.0:3000/api/flows", {
      headers: {
        origin: "https://my-app.sin.unikraft.app",
        "x-forwarded-host": "my-app.sin.unikraft.app",
        "x-forwarded-proto": "https",
      },
    });
    expect(isAllowedOrigin(reqProxy, url)).toBe(true);

    const reqHost = new Request("http://0.0.0.0:3000/api/flows", {
      headers: {
        origin: "https://my-app.sin.unikraft.app",
        host: "my-app.sin.unikraft.app",
      },
    });
    expect(isAllowedOrigin(reqHost, url)).toBe(true);

    const reqEvil = new Request("http://0.0.0.0:3000/api/flows", {
      headers: {
        origin: "https://evil.com",
        "x-forwarded-host": "my-app.sin.unikraft.app",
      },
    });
    expect(isAllowedOrigin(reqEvil, url)).toBe(false);
  });
});
