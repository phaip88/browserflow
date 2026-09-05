"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate, fmtDuration, type ExecutionRow, type FlowSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Badge, Card, PageHeader, Spinner, Table } from "@/components/ui";

export default function Dashboard() {
  const { t } = useI18n();
  const flows = useQuery({ queryKey: ["flows"], queryFn: () => api<{ flows: FlowSummary[] }>("/flows") });
  const execs = useQuery({ queryKey: ["executions", "recent"], queryFn: () => api<{ executions: ExecutionRow[] }>("/executions?limit=10"), refetchInterval: 5000 });
  const status = useQuery({ queryKey: ["system"], queryFn: () => api<{ onlineWorkerCount: number; browserReady: boolean; executions: Record<string, number> }>("/system/status"), refetchInterval: 10000 });
  if (flows.isLoading || execs.isLoading) return <Spinner />;
  const s = status.data;
  return (
    <div>
      <PageHeader
        title={t("dash.title", "Dashboard")}
        subtitle={t("dash.subtitle", "Overview of your automation platform")}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [t("dash.flows", "Flows"), flows.data?.flows.length ?? 0],
          [t("dash.queued", "Queued"), s?.executions.QUEUED ?? 0],
          [t("dash.running", "Running"), (s?.executions.RUNNING ?? 0) + (s?.executions.LEASED ?? 0) + (s?.executions.STARTING ?? 0)],
          [t("dash.workersOnline", "Workers online"), s?.onlineWorkerCount ?? 0],
        ].map(([l, v]) => (
          <Card key={String(l)}>
            <div className="text-xs uppercase text-gray-500">{l}</div>
            <div className="text-2xl font-semibold">{v}</div>
          </Card>
        ))}
      </div>
      {s && !s.browserReady && (
        <p className="mb-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t("dash.noWorkerAlert", "No browser worker with a healthy Chromium is online. Browser flows will stay QUEUED until a worker connects.")}
        </p>
      )}
      <Card
        title={t("dash.recentExecs", "Recent executions")}
        actions={<Link className="text-sm text-indigo-600" href="/executions">{t("dash.allExecs", "All executions →")}</Link>}
      >
        <Table
          rows={execs.data?.executions ?? []}
          rowKey={(r) => r.id}
          empty={t("common.empty", "Nothing here yet.")}
          cols={[
            { h: t("dash.colFlow", "Flow"), c: (r) => <Link className="text-indigo-600" href={`/executions/${r.id}`}>{r.flowName}</Link> },
            { h: t("dash.colStatus", "Status"), c: (r) => <Badge status={r.status} /> },
            { h: t("dash.colTrigger", "Trigger"), c: (r) => r.triggerType },
            { h: t("dash.colStarted", "Started"), c: (r) => fmtDate(r.startedAt ?? r.createdAt) },
            { h: t("dash.colDuration", "Duration"), c: (r) => fmtDuration(r.startedAt, r.finishedAt) },
          ]}
        />
      </Card>
    </div>
  );
}
