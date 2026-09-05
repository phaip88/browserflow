"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, fmtDate, queryClient, type FlowSummary } from "@/lib/api";
import { Badge, Button, Card, ErrorText, Field, Input, Modal, PageHeader, Select, Table } from "@/components/ui";

export default function FlowsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("updated");
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [importing, setImporting] = useState<File | null>(null);
  const list = useQuery({ queryKey: ["flows", q, sort, archived], queryFn: () => api<{ flows: FlowSummary[] }>(`/flows?q=${encodeURIComponent(q)}&sort=${sort}&archived=${archived}`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["flows"] });
  const create = useMutation({ mutationFn: () => api<{ flow: FlowSummary }>("/flows", { method: "POST", body: { name } }), onSuccess: (r) => { refresh(); router.push(`/flows/${r.flow.id}`); } });
  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: string }) => {
      if (action === "delete") { if (!confirm("Delete this flow and all its executions?")) return; await api(`/flows/${id}`, { method: "DELETE" }); }
      else if (action === "archive") await api(`/flows/${id}`, { method: "PATCH", body: { archived: true } });
      else if (action === "unarchive") await api(`/flows/${id}`, { method: "PATCH", body: { archived: false } });
      else if (action === "duplicate") await api(`/flows/${id}/duplicate`, { method: "POST", body: {} });
      else if (action === "run") { const r = await api<{ execution: { id: string } }>(`/flows/${id}/run`, { method: "POST", body: {} }); router.push(`/executions/${r.execution.id}`); }
    },
    onSuccess: refresh,
  });
  const doImport = useMutation({
    mutationFn: async () => {
      if (!importing) return;
      const parsed = JSON.parse(await importing.text());
      const r = await api<{ flow: FlowSummary }>("/flows/import", { method: "POST", body: { definition: parsed.definition ?? parsed } });
      router.push(`/flows/${r.flow.id}`);
    },
    onSuccess: refresh,
  });
  return (
    <div>
      <PageHeader title="Flows" subtitle="Drafts, published versions and executions" actions={<><label className="cursor-pointer rounded border border-gray-300 bg-white px-3 py-1.5 text-sm">Import JSON<input type="file" accept="application/json" className="hidden" onChange={(e) => { setImporting(e.target.files?.[0] ?? null); setTimeout(() => doImport.mutate(), 0); }} /></label><Button onClick={() => setCreating(true)}>New flow</Button></>} />
      <ErrorText error={act.error ?? doImport.error} />
      <Card>
        <div className="mb-3 flex gap-2"><Input placeholder="Search flows…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" /><Select value={sort} onChange={(e) => setSort(e.target.value)} className="!w-40"><option value="updated">Recently updated</option><option value="created">Recently created</option><option value="name">Name</option></Select><label className="flex items-center gap-1 text-sm"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archived</label></div>
        <Table rows={list.data?.flows ?? []} rowKey={(f) => f.id} empty="No flows yet — create one or start from a template." cols={[
          { h: "Name", c: (f) => <div><Link className="font-medium text-indigo-600" href={`/flows/${f.id}`}>{f.name}</Link><div className="text-xs text-gray-500">{f.description}</div></div> },
          { h: "Published", c: (f) => (f.currentVersionId ? <Badge status="SUCCEEDED">published</Badge> : <Badge>draft only</Badge>) },
          { h: "Updated", c: (f) => fmtDate(f.updatedAt) },
          { h: "", c: (f) => <div className="flex flex-wrap gap-1">{f.currentVersionId && !f.archivedAt && <Button variant="secondary" onClick={() => act.mutate({ id: f.id, action: "run" })}>Run</Button>}<Button variant="ghost" onClick={() => act.mutate({ id: f.id, action: "duplicate" })}>Duplicate</Button><a className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100" href={`/api/flows/${f.id}/export`}>Export</a><Button variant="ghost" onClick={() => act.mutate({ id: f.id, action: f.archivedAt ? "unarchive" : "archive" })}>{f.archivedAt ? "Unarchive" : "Archive"}</Button><Button variant="ghost" className="text-red-600" onClick={() => act.mutate({ id: f.id, action: "delete" })}>Delete</Button></div> },
        ]} />
      </Card>
      {creating && <Modal title="New flow" onClose={() => setCreating(false)}><form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3"><Field label="Name"><Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} /></Field><ErrorText error={create.error} /><div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setCreating(false)}>Cancel</Button><Button type="submit" disabled={create.isPending}>Create</Button></div></form></Modal>}
    </div>
  );
}
