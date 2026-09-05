"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, fmtDate, queryClient } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Badge, Button, Card, ErrorText, Field, Input, Modal, PageHeader, Table } from "@/components/ui";

interface Identity { id: string; name: string; description: string; lockedByExecutionId: string | null; lockExpiresAt: string | null; lastUsedAt: string | null; createdAt: string }

export default function IdentitiesPage() {
  const { t } = useI18n();
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
      <PageHeader
        title={t("ident.title", "Identities")}
        subtitle={t("ident.subtitle", "Persistent Chromium profiles (cookies, storage). Each identity has its own directory and is used by at most one execution at a time.")}
        actions={<Button onClick={() => setOpen(true)}>{t("ident.new", "New identity")}</Button>}
      />
      <ErrorText error={del.error ?? reset.error} />
      <Card>
        <Table
          rows={list.data?.identities ?? []}
          rowKey={(i) => i.id}
          empty={t("common.empty", "Nothing here yet.")}
          cols={[
            {
              h: t("ident.colName", "Name"),
              c: (i) => (
                <div>
                  <div className="font-medium">{i.name}</div>
                  <div className="text-xs text-gray-500">{i.description}</div>
                  <code className="text-[10px] text-gray-400">{i.id}</code>
                </div>
              ),
            },
            {
              h: t("ident.colLock", "Lock"),
              c: (i) =>
                i.lockedByExecutionId && i.lockExpiresAt && new Date(i.lockExpiresAt).getTime() > Date.now() ? (
                  <Badge status="RUNNING">{t("ident.inUse", "in use")}</Badge>
                ) : (
                  <Badge status="SUCCEEDED">{t("ident.free", "free")}</Badge>
                ),
            },
            { h: t("ident.colLastUsed", "Last used"), c: (i) => fmtDate(i.lastUsedAt) },
            {
              h: "",
              c: (i) => (
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    onClick={() => confirm(t("ident.resetConfirm", "Wipe the browser profile (cookies/storage)?")) && reset.mutate(i.id)}
                  >
                    {t("ident.resetProfile", "Reset profile")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => confirm(t("ident.deleteConfirm", "Delete identity and its profile?")) && del.mutate(i.id)}
                  >
                    {t("common.delete", "Delete")}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {open && (
        <Modal title={t("ident.modalTitle", "New identity")} onClose={() => setOpen(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label={t("common.name", "Name")}>
              <Input required value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label={t("ident.desc", "Description")}>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
            <ErrorText error={create.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {t("common.create", "Create")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
