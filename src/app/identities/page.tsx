"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, fmtDate, queryClient } from "@/lib/api";
import { Badge, Button, Card, ErrorText, Field, Input, Modal, PageHeader, Table } from "@/components/ui";

interface Identity { id: string; name: string; description: string; lockedByExecutionId: string | null; lockExpiresAt: string | null; lastUsedAt: string | null; createdAt: string }
export default function IdentitiesPage() {
  const list = useQuery({ queryKey: ["identities"], queryFn: () => api<{ identities: Identity[] }>("/identities"), refetchInterval: 8000 });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["identities"] });
  const create = useMutation({ mutationFn: () => api("/identities", { method: "POST", body: { name, description } }), onSuccess: () => { refresh(); setOpen(false); setName(""); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/identities/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const reset = useMutation({ mutationFn: (id: string) => api(`/identities/${id}/reset-profile`, { method: "POST", body: {} }), onSuccess: refresh });
  return (
    <div>
      <PageHeader title="Identities" subtitle="Persistent Chromium profiles (cookies, storage). Each identity has its own directory and is used by at most one execution at a time." actions={<Button onClick={() => setOpen(true)}>New identity</Button>} />
      <ErrorText error={del.error ?? reset.error} />
      <Card><Table rows={list.data?.identities ?? []} rowKey={(i) => i.id} cols={[
        { h: "Name", c: (i) => <div><div className="font-medium">{i.name}</div><div className="text-xs text-gray-500">{i.description}</div><code className="text-[10px] text-gray-400">{i.id}</code></div> },
        { h: "Lock", c: (i) => (i.lockedByExecutionId && i.lockExpiresAt && new Date(i.lockExpiresAt).getTime() > Date.now() ? <Badge status="RUNNING">in use</Badge> : <Badge status="SUCCEEDED">free</Badge>) },
        { h: "Last used", c: (i) => fmtDate(i.lastUsedAt) },
        { h: "", c: (i) => <div className="flex gap-1"><Button variant="ghost" onClick={() => confirm("Wipe the browser profile (cookies/storage)?") && reset.mutate(i.id)}>Reset profile</Button><Button variant="ghost" className="text-red-600" onClick={() => confirm("Delete identity and its profile?") && del.mutate(i.id)}>Delete</Button></div> },
      ]} /></Card>
      {open && <Modal title="New identity" onClose={() => setOpen(false)}><form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}><Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field><Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field><ErrorText error={create.error} /><div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={create.isPending}>Create</Button></div></form></Modal>}
    </div>
  );
}
