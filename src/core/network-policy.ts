import dns from "node:dns/promises";
import net from "node:net";
import { config } from "./config";
import { errors } from "./security";

/**
 * NetworkPolicy blocks SSRF targets: loopback, link-local, RFC1918, CGNAT, IPv6 local,
 * cloud metadata, multicast, unspecified. Handles IPv4-mapped IPv6 and decimal/hex/octal IPv4 forms.
 */
const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal", "metadata", "postgres", "redis", "api", "browser-worker", "scheduler", "web", "host.docker.internal", "gateway.docker.internal"]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}
function inRange(ip: number, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const b = ipv4ToInt(base);
  if (b === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((ip & mask) >>> 0) === ((b & mask) >>> 0);
}
const BLOCKED_V4 = [
  "0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12",
  "192.0.0.0/24", "192.0.2.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24",
  "224.0.0.0/4", "240.0.0.0/4", "255.255.255.255/32",
];

/** Normalize unusual IPv4 representations (decimal, hex, octal, shorthand) to dotted quad, or null. */
export function normalizeIPv4Literal(host: string): string | null {
  if (net.isIPv4(host)) return host;
  if (/^0x[0-9a-f]+$/i.test(host)) {
    const n = Number.parseInt(host, 16);
    return Number.isFinite(n) && n <= 0xffffffff ? intToIPv4(n) : null;
  }
  if (/^\d+$/.test(host)) {
    const n = Number(host);
    return n <= 0xffffffff ? intToIPv4(n) : null;
  }
  if (/^[0-9a-fx.]+$/i.test(host) && host.includes(".")) {
    const parts = host.split(".");
    if (parts.length >= 2 && parts.length <= 4) {
      const nums = parts.map((p) => (/^0x/i.test(p) ? Number.parseInt(p, 16) : /^0\d+$/.test(p) ? Number.parseInt(p, 8) : Number(p)));
      if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
      const last = nums[nums.length - 1];
      let n = 0;
      for (let i = 0; i < nums.length - 1; i++) {
        if (nums[i] > 255) return null;
        n = n * 256 + nums[i];
      }
      const remainingBytes = 4 - (nums.length - 1);
      if (last >= 256 ** remainingBytes) return null;
      n = n * 256 ** remainingBytes + last;
      return intToIPv4(n);
    }
  }
  return null;
}
function intToIPv4(n: number): string {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}

export function isBlockedIp(ipRaw: string): boolean {
  let ip = ipRaw.toLowerCase();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  if (ip.includes("%")) ip = ip.split("%")[0];
  if (net.isIPv6(ip)) {
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/) ?? ip.match(/^0{0,4}:0{0,4}:0{0,4}:0{0,4}:0{0,4}:ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIp(mapped[1]);
    const hexMapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMapped) {
      const n = (Number.parseInt(hexMapped[1], 16) << 16) + Number.parseInt(hexMapped[2], 16);
      return isBlockedIp(intToIPv4(n >>> 0));
    }
    if (ip === "::" || ip === "::1") return true;
    if (/^fe[89ab]/.test(ip)) return true; // link-local
    if (/^f[cd]/.test(ip)) return true; // unique local
    if (/^ff/.test(ip)) return true; // multicast
    if (ip.startsWith("64:ff9b:")) return true; // NAT64 (may map to private)
    if (ip.startsWith("2001:db8")) return true; // documentation
    return false;
  }
  const v4 = normalizeIPv4Literal(ip);
  if (!v4) return true; // unknown form -> block
  const n = ipv4ToInt(v4);
  if (n === null) return true;
  return BLOCKED_V4.some((c) => inRange(n, c));
}

function allowListed(ipOrHost: string): boolean {
  const list = config.network.privateAllowList;
  if (list.length === 0) return false;
  for (const entry of list) {
    if (entry === ipOrHost) return true;
    if (entry.includes("/") && net.isIPv4(ipOrHost)) {
      const n = ipv4ToInt(ipOrHost);
      if (n !== null && inRange(n, entry)) return true;
    }
  }
  return false;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  resolvedIps?: string[];
}

export function checkUrlSyntax(rawUrl: string, allowedSchemes: string[] = config.network.allowedSchemes): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw errors.network("INVALID_URL", `Invalid URL`);
  }
  if (!allowedSchemes.includes(url.protocol)) {
    throw errors.network("SCHEME_BLOCKED", `URL scheme ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) throw errors.network("CREDENTIALS_IN_URL", "Credentials in URL are not allowed");
  return url;
}

/** Check a hostname/IP without DNS (sync). Used by the browser route interceptor for literal IPs & hostnames. */
export function checkHostSync(hostRaw: string): PolicyDecision {
  const host = hostRaw.toLowerCase().replace(/\.$/, "");
  if (allowListed(host)) return { allowed: true };
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    return { allowed: false, reason: `Hostname ${host} is blocked by policy` };
  }
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  if (net.isIP(bare) || normalizeIPv4Literal(bare)) {
    if (isBlockedIp(bare) && !allowListed(bare)) return { allowed: false, reason: `IP ${bare} is in a blocked range` };
  }
  return { allowed: true };
}

/** Full check with DNS resolution of every A/AAAA record (HTTP node; also used pre-goto). */
export async function checkUrlWithDns(rawUrl: string): Promise<{ url: URL; ips: string[] }> {
  const url = checkUrlSyntax(rawUrl);
  const host = url.hostname.toLowerCase();
  const syn = checkHostSync(host);
  if (!syn.allowed) throw errors.network("HOST_BLOCKED", syn.reason ?? "blocked");
  const bare = host.startsWith("[") ? host.slice(1, -1) : host;
  if (net.isIP(bare)) return { url, ips: [bare] };
  let records: string[] = [];
  try {
    const res = await dns.lookup(bare, { all: true, verbatim: true });
    records = res.map((r) => r.address);
  } catch {
    throw errors.network("DNS_FAILED", `DNS resolution failed for ${bare}`);
  }
  if (records.length === 0) throw errors.network("DNS_FAILED", `No addresses for ${bare}`);
  for (const ip of records) {
    if (isBlockedIp(ip) && !allowListed(ip) && !allowListed(bare)) {
      throw errors.network("IP_BLOCKED", `Host ${bare} resolves to blocked address`);
    }
  }
  return { url, ips: records };
}

export const browserRequestPolicy = {
  /** Sync decision for route interception (page resources, iframes, popups, websockets, redirects). */
  decide(rawUrl: string): PolicyDecision {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { allowed: false, reason: "invalid url" };
    }
    if (url.protocol === "about:" || url.protocol === "data:" || url.protocol === "blob:") return { allowed: true };
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return { allowed: false, reason: `scheme ${url.protocol} blocked` };
    return checkHostSync(url.hostname);
  },
};
