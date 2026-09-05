"use client";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, fmtDate, queryClient, type FlowSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Badge, Button, Card, ErrorText, Field, Input, Modal, PageHeader, Select, Table } from "@/components/ui";

interface Schedule { id: string; flowId: string; name: string; kind: string; cronExpression: string | null; runAt: string | null; timezone: string; enabled: boolean; misfirePolicy: string; overlapPolicy: string; lastFireAt: string | null; nextFireAt: string | null; lastExecutionId: string | null }
const empty = { flowId: "", name: "", kind: "cron", cronExpression: "*/15 * * * *", runAt: "", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", misfirePolicy: "RUN_ONCE", overlapPolicy: "SKIP", enabled: true };

export default function SchedulesPage() {
  const { t } = useI18n();
  const list = useQuery({ queryKey: ["schedules"], queryFn: () => api<{ schedules: Schedule[] }>("/schedules"), refetchInterval: 10000 });
  const flows = useQuery({ queryKey: ["flows"], queryFn: () => api<{ flows: FlowSummary[] }>("/flows") });
  const [form, setForm] = useState<typeof empty | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["schedules"] });
  const create = useMutation({ mutationFn: () => api("/schedules", { method: "POST", body: { ...form!, cronExpression: form!.kind === "cron" ? form!.cronExpression : undefined, runAt: form!.kind === "once" ? new Date(form!.runAt).toISOString() : undefined } }), onSuccess: () => { refresh(); setForm(null); } });
  const toggle = useMutation({ mutationFn: (s: Schedule) => api(`/schedules/${s.id}`, { method: "PUT", body: { enabled: !s.enabled } }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`/schedules/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const runNow = useMutation({ mutationFn: (id: string) => api(`/schedules/${id}/run-now`, { method: "POST", body: {} }), onSuccess: refresh });
  const published = (flows.data?.flows ?? []).filter((f) => f.currentVersionId);
  return (
    <div>
      <PageHeader
        title={t("sched.title", "Schedules")}
        subtitle={t("sched.subtitle", "Persistent cron and one-shot schedules (survive restarts, de-duplicated by planned fire time)")}
        actions={<Button onClick={() => setForm({ ...empty, flowId: published[0]?.id ?? "" })}>{t("sched.new", "New schedule")}</Button>}
      />
      <ErrorText error={toggle.error ?? del.error ?? runNow.error} />
      <Card>
        <Table
          rows={list.data?.schedules ?? []}
          rowKey={(s) => s.id}
          empty={t("common.empty", "Nothing here yet.")}
          cols={[
            {
              h: t("sched.colName", "Name"),
              c: (s) => (
                <div>
                  <div className="font-medium">{s.name}</div>
                  <Link className="text-xs text-indigo-600 hover:underline" href={`/flows/${s.flowId}`}>
                    {flows.data?.flows.find((f) => f.id === s.flowId)?.name ?? s.flowId.slice(0, 8)}
                  </Link>
                </div>
              ),
            },
            {
              h: t("sched.colWhen", "When"),
              c: (s) => (
                <span className="font-mono text-xs">
                  {s.kind === "cron" ? s.cronExpression : fmtDate(s.runAt)}
                  <div className="text-gray-500">{s.timezone}</div>
                </span>
              ),
            },
            {
              h: t("sched.colPolicies", "Policies"),
              c: (s) => (
                <span className="text-xs">
                  misfire {s.misfirePolicy}
                  <br />
                  overlap {s.overlapPolicy}
                </span>
              ),
            },
            {
              h: t("sched.colState", "State"),
              c: (s) => (
                <Badge status={s.enabled ? "ONLINE" : "STOPPED"}>
                  {s.enabled ? t("sched.enable", "enabled") : t("sched.disable", "disabled")}
                </Badge>
              ),
            },
            {
              h: t("sched.colLastNext", "Last / Next"),
              c: (s) => (
                <span className="text-xs">
                  {fmtDate(s.lastFireAt)}
                  <br />
                  {fmtDate(s.nextFireAt)}
                </span>
              ),
            },
            {
              h: t("sched.colLastRun", "Last run"),
              c: (s) =>
                s.lastExecutionId ? (
                  <Link className="font-mono text-xs text-indigo-600 hover:underline" href={`/executions/${s.lastExecutionId}`}>
                    {s.lastExecutionId.slice(0, 8)}
                  </Link>
                ) : (
                  "—"
                ),
            },
            {
              h: "",
              c: (s) => (
                <div className="flex gap-1">
                  <Button variant="secondary" onClick={() => runNow.mutate(s.id)}>
                    {t("sched.runNow", "Run now")}
                  </Button>
                  <Button variant="ghost" onClick={() => toggle.mutate(s)}>
                    {s.enabled ? t("sched.disable", "Disable") : t("sched.enable", "Enable")}
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => confirm(t("sched.deleteConfirm", "Delete schedule?")) && del.mutate(s.id)}
                  >
                    {t("common.delete", "Delete")}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {form && (
        <Modal title={t("sched.modalTitle", "New schedule")} onClose={() => setForm(null)}>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label={t("sched.fieldFlow", "Flow (published only)")}>
              <Select required value={form.flowId} onChange={(e) => setForm({ ...form, flowId: e.target.value })}>
                <option value="">{t("sched.fieldFlowSelect", "Select…")}</option>
                {published.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("sched.fieldName", "Name")}>
              <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label={t("sched.fieldType", "Type")}>
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="cron">{t("sched.typeCron", "Cron (recurring)")}</option>
                <option value="once">{t("sched.typeOnce", "One-shot")}</option>
              </Select>
            </Field>
            {form.kind === "cron" ? (
              <Field label={t("sched.fieldCron", "Cron expression")} help="Standard 5-field cron, e.g. */15 * * * *">
                <Input required value={form.cronExpression} onChange={(e) => setForm({ ...form, cronExpression: e.target.value })} />
              </Field>
            ) : (
              <Field label={t("sched.fieldRunAt", "Run at")}>
                <Input type="datetime-local" required value={form.runAt} onChange={(e) => setForm({ ...form, runAt: e.target.value })} />
              </Field>
            )}
            <Field label={t("sched.fieldTz", "Timezone")}>
              <Input value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("sched.fieldMisfire", "Misfire policy")}>
                <Select value={form.misfirePolicy} onChange={(e) => setForm({ ...form, misfirePolicy: e.target.value })}>
                  <option>SKIP</option>
                  <option>RUN_ONCE</option>
                  <option>CATCH_UP_LIMITED</option>
                </Select>
              </Field>
              <Field label={t("sched.fieldOverlap", "Overlap policy")}>
                <Select value={form.overlapPolicy} onChange={(e) => setForm({ ...form, overlapPolicy: e.target.value })}>
                  <option>SKIP</option>
                  <option>QUEUE</option>
                  <option>REPLACE</option>
                </Select>
              </Field>
            </div>
            <ErrorText error={create.error} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setForm(null)}>
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
