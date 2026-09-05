import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/health": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/metrics": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/auth": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/flows": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/executions": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true, ws: true },
      "/credentials": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/identities": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/schedules": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/templates": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/settings": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true },
      "/system": { target: process.env.VITE_API_PROXY ?? "http://127.0.0.1:8000", changeOrigin: true },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 8080,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
