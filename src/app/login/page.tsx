"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, queryClient, setCsrfToken, type AuthStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const { lang, setLang, t } = useI18n();
  const status = useQuery({ queryKey: ["auth"], queryFn: () => api<AuthStatus>("/auth/status") });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const setup = !status.data?.initialized;
  const m = useMutation({
    mutationFn: async () => {
      if (setup) await api("/auth/setup", { method: "POST", body: { email, password } });
      const r = await api<{ csrfToken: string }>("/auth/login", { method: "POST", body: { email, password } });
      setCsrfToken(r.csrfToken);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["auth"] });
      router.replace("/");
    },
  });

  const toggleLang = () => {
    setLang(lang === "zh" ? "en" : "zh");
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 relative">
      <div className="absolute top-4 right-4">
        <button
          type="button"
          onClick={toggleLang}
          className="rounded border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition"
        >
          🌐 {lang === "zh" ? "English" : "中文"}
        </button>
      </div>
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-indigo-700">
          {t("login.title", "BrowserFlow")}
        </h1>
        <p className="mb-4 text-center text-sm text-gray-500">
          {setup
            ? t("login.setupSubtitle", "Create the administrator account")
            : t("login.signInSubtitle", "Sign in to continue")}
        </p>
        <Card>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <Field label={t("login.email", "Email")}>
              <Input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field
              label={t("login.password", "Password")}
              help={
                setup
                  ? t("login.passwordHelp", "At least 12 characters with 3 of: lowercase, uppercase, digits, symbols")
                  : undefined
              }
            >
              <Input
                type="password"
                autoComplete={setup ? "new-password" : "current-password"}
                required
                minLength={setup ? 12 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <ErrorText error={m.error} />
            <Button
              type="submit"
              className="w-full"
              disabled={m.isPending || status.isLoading}
            >
              {m.isPending
                ? t("login.pleaseWait", "Please wait…")
                : setup
                ? t("login.initBtn", "Initialize administrator")
                : t("login.signInBtn", "Sign in")}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
