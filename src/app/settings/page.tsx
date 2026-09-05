"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button, Card, ErrorText, Field, Input, PageHeader, Spinner } from "@/components/ui";

export default function SettingsPage() {
  const { t } = useI18n();
  const s = useQuery({ queryKey: ["settings"], queryFn: () => api<{ limits: Record<string, number>; worker: Record<string, number | boolean>; scheduler: Record<string, number>; authMode: string; privateAllowList: string[]; warnings: { level: string; message: string }[] }>("/settings") });
  const [cur, setCur] = useState(""); const [next, setNext] = useState("");
  const pw = useMutation({ mutationFn: () => api("/auth/change-password", { method: "POST", body: { currentPassword: cur, newPassword: next } }), onSuccess: () => { setCur(""); setNext(""); } });
  const ai = useQuery({ queryKey: ["ai"], queryFn: () => api<{ provider: string; enabled: boolean }>("/ai/status") });
  if (s.isLoading || !s.data) return <Spinner />;
  return (
    <div>
      <PageHeader
        title={t("settings.title", "Settings")}
        subtitle={t("settings.subtitle", "Runtime limits are configured through environment variables and validated at startup.")}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={t("settings.changePw", "Change password")}>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); pw.mutate(); }}>
            <Field label={t("settings.curPw", "Current password")}>
              <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} required />
            </Field>
            <Field
              label={t("settings.newPw", "New password")}
              help={t("settings.pwHelp", "12+ chars, 3 character classes; other sessions are revoked")}
            >
              <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={12} />
            </Field>
            <ErrorText error={pw.error} />
            {pw.isSuccess && <p className="text-sm text-emerald-700">{t("settings.pwSuccess", "Password changed.")}</p>}
            <Button type="submit" disabled={pw.isPending || s.data.authMode !== "authenticated"}>
              {t("settings.updatePwBtn", "Update password")}
            </Button>
          </form>
        </Card>
        <Card title={t("settings.aiTitle", "AI assistant")}>
          <p className="text-sm text-gray-600">
            {t("settings.aiDesc", "Provider:")} <code>{ai.data?.provider ?? "…"}</code> — {ai.data?.enabled ? "enabled" : "not configured"}.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Release 1 ships the provider-neutral interface and tool schemas only. Real providers, AI flow builder and repair arrive in Release 3 — no assistant UI is shown until a provider is configured.
          </p>
        </Card>
        <Card title={t("settings.secTitle", "Security & network")}>
          <ul className="space-y-1 text-sm">
            <li>{t("settings.authMode", "Auth mode:")} <code>{s.data.authMode}</code></li>
            <li>{t("settings.privateAllowList", "Private network allow-list:")} <code>{s.data.privateAllowList.join(", ") || "(none — all private ranges blocked)"}</code></li>
          </ul>
          {s.data.warnings.length > 0 && (
            <ul className="mt-2 space-y-1">
              {s.data.warnings.map((w, i) => (
                <li key={i} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">{w.level}: {w.message}</li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("settings.resourceLimits", "Resource limits (read-only)")}>
          <table className="w-full text-xs">
            <tbody>
              {Object.entries({ ...s.data.limits, ...s.data.worker, ...s.data.scheduler }).map(([k, v]) => (
                <tr key={k} className="border-b border-gray-50">
                  <td className="py-0.5 font-mono text-gray-600">{k}</td>
                  <td className="py-0.5 text-right">{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
