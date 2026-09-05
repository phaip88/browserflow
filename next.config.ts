import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["argon2", "pg", "prom-client"],
  poweredByHeader: false,
  headers: async () => [{ source: "/(.*)", headers: [{ key: "X-Content-Type-Options", value: "nosniff" }, { key: "X-Frame-Options", value: "DENY" }, { key: "Referrer-Policy", value: "no-referrer" }] }],
};

export default nextConfig;
