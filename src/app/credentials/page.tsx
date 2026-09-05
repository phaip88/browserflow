"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, fmtDate, queryClient } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button, Card, ErrorText, Field, Input, Modal, PageHeader, Select, Table } from "@/components/ui";

interface Cred { id: string; name: string; kind: string; fieldNames: string[]; createdAt: string; updatedAt: string }

export default function CredentialsPage() {
  const { t } = useI18n();
  const list = useQuery({ queryKey: ["credentials"], queryFn: () => api<{ credentials: Cred[] }>("/credentials") });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("password");
  const [fields, setFields] = useState<{ k: string; v: string }[]>([{ k: "username", v: "" }, { k: "password", v: "" }]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["credentials"] });
  const create = useMutation({ mutationFn: () => api("/credentials", { method: "POST", body: { name, kind, fields: Object.fromEntries(fields.filter((f) => f.k).map((f) => [f.k, f.v])) } }), onSuccess: () => { refresh(); setOpen(false); setFields([{ k: "username", v: "" }, { k: "password", v: "" }]); setName(""); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/credentials/${id}`, { method: "DELETE" }), onSuccess: refresh });
  return (
    <div>
      <PageHeader
        title={t("cred.title", "Credentials")}
        subtitle={t("cred.subtitle", "Encrypted with AES-256-GCM under the master key. Values are never shown again; flows reference them as credential:<name>#<field>.")}
        actions={<Button onClick={() => setOpen(true)}>{t("cred.new", "New credential")}</Button>}
      />
      <ErrorText error={del.error} />
      <Card>
        <Table
          rows={list.data?.credentials ?? []}
          rowKey={(c) => c.id}
          empty={t("common.empty", "Nothing here yet.")}
          cols={[
            { h: t("cred.colName", "Name"), c: (c) => <span className="font-medium">{c.name}</span> },
            { h: t("cred.colKind", "Kind"), c: (c) => c.kind },
            {
              h: t("cred.colFields", "Fields / references"),
              c: (c) => (
                <div className="space-y-0.5">
                  {c.fieldNames.map((f) => (
                    <code key={f} className="block rounded bg-gray-100 px-1 text-xs">
                      credential:{c.name}#{f}
                    </code>
                  ))}
                </div>
              ),
            },
            { h: t("cred.colUpdated", "Updated"), c: (c) => fmtDate(c.updatedAt) },
            {
              h: "",
              c: (c) => (
                <Button
                  variant="ghost"
                  className="text-red-600 hover:bg-red-50"
                  onClick={() => confirm(t("cred.deleteConfirm", "Delete credential? Flows referencing it will fail at runtime.")) && del.mutate(c.id)}
                >
                  {t("common.delete", "Delete")}
                </Button>
              ),
            },
          ]}
        />
      </Card>
      {open && (
        <Modal title={t("cred.modalTitle", "New credential")} onClose={() => setOpen(false)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label={t("cred.colName", "Name")}>
              <Input
                required
                pattern="[A-Za-z0-9_-]+"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("cred.namePlaceholder", "site-login")}
              />
            </Field>
            <Field label={t("cred.colKind", "Kind")}>
              <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="password">password</option>
                <option value="token">token</option>
                <option value="custom">custom</option>
              </Select>
            </Field>
            <div className="space-y-2">
              <div className="text-sm font-medium">{t("cred.colFields", "Fields")}</div>
              {fields.map((f, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder={t("cred.field", "field")}
                    value={f.k}
                    onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))}
                  />
                  <Input
                    type="password"
                    placeholder={t("cred.secretValue", "secret value")}
                    autoComplete="new-password"
                    value={f.v}
                    onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))}
                  />
                  <Button type="button" variant="ghost" onClick={() => setFields(fields.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                </div>
              ))}
              <Button type="button" variant="secondary" onClick={() => setFields([...fields, { k: "", v: "" }])}>
                {t("cred.addField", "Add field")}
              </Button>
            </div>
            <ErrorText error={create.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t("common.cancel", "Cancel")}
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {t("cred.saveEncrypted", "Save encrypted")}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
