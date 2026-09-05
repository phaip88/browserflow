"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, queryClient } from "@/lib/api";
import { Button, Card, ErrorText, Field, Input, Modal, PageHeader, Spinner } from "@/components/ui";

interface T { id: string; name: string; description: string; category: string; nodeCount: number }
export default function TemplatesPage() {
  const router = useRouter();
  const list = useQuery({ queryKey: ["templates"], queryFn: () => api<{ templates: T[] }>("/templates") });
  const [pick, setPick] = useState<T | null>(null);
  const [name, setName] = useState("");
  const create = useMutation({ mutationFn: () => api<{ flow: { id: string } }>("/flows", { method: "POST", body: { name, templateId: pick!.id } }), onSuccess: (r) => { queryClient.invalidateQueries({ queryKey: ["flows"] }); router.push(`/flows/${r.flow.id}`); } });
  if (list.isLoading) return <Spinner />;
  return (
    <div>
      <PageHeader title="Templates" subtitle="Templates create an editable Draft; nothing runs automatically. They target the bundled local E2E site (variable baseUrl)." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.data?.templates.map((t) => <Card key={t.id} title={t.name} actions={<Button onClick={() => { setPick(t); setName(t.name); }}>Use</Button>}><p className="text-sm text-gray-600">{t.description}</p><p className="mt-2 text-xs text-gray-400">{t.category} · {t.nodeCount} nodes</p></Card>)}
      </div>
      {pick && <Modal title={`Create draft from “${pick.name}”`} onClose={() => setPick(null)}><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}><Field label="Flow name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field><ErrorText error={create.error} /><div className="flex justify-end gap-2"><Button variant="secondary" type="button" onClick={() => setPick(null)}>Cancel</Button><Button type="submit" disabled={create.isPending}>Create draft</Button></div></form></Modal>}
    </div>
  );
}
