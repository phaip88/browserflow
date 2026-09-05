"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, fmtDate, fmtDuration, type ExecutionRow } from "@/lib/api";
import { Badge, Card, PageHeader, Select, Table } from "@/components/ui";

const STATUSES = ["", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "TIMED_OUT", "WORKER_LOST", "CANCELLING"];
export default function ExecutionsPage() {
  const [status, setStatus] = useState("");
  const list = useQuery({ queryKey: ["executions", status], queryFn: () => api<{ executions: ExecutionRow[] }>(`/executions?limit=100${status ? `&status=${status}` : ""}`), refetchInterval: 4000 });
  return (
    <div>
      <PageHeader title="Executions" subtitle="History persists across restarts" actions={<Select value={status} onChange={(e) => setStatus(e.target.value)} className="!w-44">{STATUSES.map((s) => <option key={s} value={s}>{s || "All statuses"}</option>)}</Select>} />
      <Card>
        <Table rows={list.data?.executions ?? []} rowKey={(r) => r.id} cols={[
          { h: "Execution", c: (r) => <Link className="font-mono text-xs text-indigo-600" href={`/executions/${r.id}`}>{r.id.slice(0, 8)}</Link> },
          { h: "Flow", c: (r) => <Link className="text-indigo-600" href={`/flows/${r.flowId}`}>{r.flowName}</Link> },
          { h: "Status", c: (r) => <Badge status={r.status} /> },
          { h: "Trigger", c: (r) => r.triggerType },
          { h: "Attempts", c: (r) => `${r.attemptCount}/${r.maxAttempts}` },
          { h: "Created", c: (r) => fmtDate(r.createdAt) },
          { h: "Duration", c: (r) => fmtDuration(r.startedAt, r.finishedAt) },
          { h: "Error", c: (r) => <span className="font-mono text-xs text-red-700">{r.errorCode ?? ""}</span> },
        ]} />
      </Card>
    </div>
  );
}
