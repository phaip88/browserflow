"use client";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Badge, Card, PageHeader, Spinner, Table } from "@/components/ui";

interface Worker { id: string; hostname: string; pid: number; status: string; capacity: number; capabilities: string[]; playwrightVersion: string | null; browserVersion: string | null; browserHealthy: boolean; lastHeartbeatAt: string; startedAt: string }
interface Status { service: { name: string; version: string; nodeRegistryVersion: string; playwrightVersion: string; env: string; authMode: string }; workers: Worker[]; onlineWorkerCount: number; browserReady: boolean; executions: Record<string, number>; artifacts: { count: number; bytes: number; quotaBytes: number }; disk: { freeBytes: number; totalBytes: number } | null; ai: { provider: string; enabled: boolean; tools: string[] }; configWarnings: { level: string; message: string }[] }
const gb = (n: number) => `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;

export default function SystemPage() {
  const { t } = useI18n();
  const s = useQuery({ queryKey: ["system"], queryFn: () => api<Status>("/system/status"), refetchInterval: 5000 });
  const ready = useQuery({ queryKey: ["ready"], queryFn: () => api<{ status: string; database: boolean; workersOnline: number; browserReady: boolean }>("/health/ready"), refetchInterval: 5000 });
  if (!s.data) return <Spinner />;
  const d = s.data;
  return (
    <div>
      <PageHeader
        title={t("system.title", "System status")}
        subtitle={`${d.service.name} ${d.service.version} · registry ${d.service.nodeRegistryVersion} · Playwright ${d.service.playwrightVersion} · ${d.service.env}`}
      />
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Card>
          <div className="text-xs uppercase text-gray-500">{t("system.readiness", "Readiness")}</div>
          <Badge status={ready.data?.status === "ready" ? "SUCCEEDED" : "FAILED"}>{ready.data?.status ?? "…"}</Badge>
          <div className="text-xs text-gray-500">db {ready.data?.database ? "ok" : "down"}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-gray-500">{t("system.workers", "Workers")}</div>
          <div className="text-2xl font-semibold">{d.onlineWorkerCount}</div>
          <div className="text-xs">{d.browserReady ? "Chromium healthy" : "no healthy browser"}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-gray-500">{t("system.artifacts", "Artifacts")}</div>
          <div className="text-2xl font-semibold">{d.artifacts.count}</div>
          <div className="text-xs">{gb(d.artifacts.bytes)} / {gb(d.artifacts.quotaBytes)}</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-gray-500">{t("system.disk", "Disk (data dir)")}</div>
          <div className="text-2xl font-semibold">{d.disk ? gb(d.disk.freeBytes) : "—"}</div>
          <div className="text-xs">free of {d.disk ? gb(d.disk.totalBytes) : "—"}</div>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("system.browserWorkers", "Browser workers")}>
          <Table
            rows={d.workers}
            rowKey={(w) => w.id}
            empty={t("common.empty", "Nothing here yet.")}
            cols={[
              { h: "Worker", c: (w) => <span className="font-mono text-xs">{w.id}</span> },
              { h: t("common.status", "Status"), c: (w) => <Badge status={w.status} /> },
              { h: "Browser", c: (w) => <span className="text-xs">{w.browserVersion ?? "—"} {w.browserHealthy ? "✓" : "✗"}</span> },
              { h: "Cap.", c: (w) => w.capacity },
              { h: "Heartbeat", c: (w) => <span className="text-xs">{fmtDate(w.lastHeartbeatAt)}</span> },
            ]}
          />
        </Card>
        <Card title={t("system.execByStatus", "Executions by status")}>
          <div className="flex flex-wrap gap-2">
            {Object.entries(d.executions).map(([k, v]) => (
              <div key={k} className="rounded border border-gray-100 px-3 py-1 text-sm">
                <Badge status={k} /> <span className="ml-1 font-semibold">{v}</span>
              </div>
            ))}
            {Object.keys(d.executions).length === 0 && (
              <span className="text-sm text-gray-400">{t("common.empty", "No executions yet")}</span>
            )}
          </div>
        </Card>
        <Card title="AI">
          <p className="text-sm">
            Provider <code>{d.ai.provider}</code> · {d.ai.enabled ? "enabled" : "disabled"} · {d.ai.tools.length} tool schemas registered
          </p>
        </Card>
        <Card title="Configuration warnings">
          {d.configWarnings.length === 0 ? (
            <p className="text-sm text-gray-500">None</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.configWarnings.map((w, i) => (
                <li key={i} className="rounded bg-amber-50 px-2 py-1 text-amber-800">{w.message}</li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-gray-500">Endpoints: <code>/api/health/live</code>, <code>/api/health/ready</code>, <code>/api/metrics</code></p>
        </Card>
      </div>
    </div>
  );
}
