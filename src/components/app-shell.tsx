"use client";
import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { api, queryClient, setCsrfToken, type AuthStatus } from "@/lib/api";
import { I18nProvider, useI18n } from "@/lib/i18n";
import { Button, Spinner } from "./ui";

const NAV_ITEMS = [
  { href: "/", key: "nav.dashboard", default: "Dashboard" },
  { href: "/flows", key: "nav.flows", default: "Flows" },
  { href: "/executions", key: "nav.executions", default: "Executions" },
  { href: "/schedules", key: "nav.schedules", default: "Schedules" },
  { href: "/credentials", key: "nav.credentials", default: "Credentials" },
  { href: "/identities", key: "nav.identities", default: "Identities" },
  { href: "/templates", key: "nav.templates", default: "Templates" },
  { href: "/settings", key: "nav.settings", default: "Settings" },
  { href: "/system", key: "nav.system", default: "System" },
] as const;

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { lang, setLang, t } = useI18n();
  const auth = useQuery({ queryKey: ["auth"], queryFn: () => api<AuthStatus>("/auth/status"), retry: false });

  useEffect(() => {
    setCsrfToken(auth.data?.csrfToken ?? null);
    if ((auth.isError || (auth.data && !auth.data.authenticated)) && pathname !== "/login") {
      router.replace("/login");
    }
    if (auth.data?.authenticated && pathname === "/login") {
      router.replace("/");
    }
  }, [auth.data, auth.isError, pathname, router]);

  if (pathname === "/login") return <>{children}</>;
  if (auth.isLoading || !auth.data?.authenticated) return <Spinner />;

  const logout = async () => {
    await api("/auth/logout", { method: "POST" });
    setCsrfToken(null);
    queryClient.clear();
    router.replace("/login");
  };

  const toggleLang = () => {
    setLang(lang === "zh" ? "en" : "zh");
  };

  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="flex w-52 shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3 flex items-center justify-between">
          <div>
            <Link href="/" className="text-lg font-bold text-indigo-700">
              {t("nav.brand", "BrowserFlow")}
            </Link>
            <div className="text-[10px] uppercase tracking-wide text-gray-400">
              {t("nav.subtitle", "single-user · self-hosted")}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleLang}
            title={lang === "zh" ? "Switch to English" : "切换为中文"}
            className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 hover:bg-gray-100 hover:text-indigo-600 transition"
          >
            {lang === "zh" ? "EN" : "中"}
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded px-3 py-1.5 text-sm ${
                pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href))
                  ? "bg-indigo-50 font-medium text-indigo-700"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {t(item.key, item.default)}
            </Link>
          ))}
        </nav>
        <div className="border-t border-gray-100 p-3 text-xs text-gray-500">
          <div className="truncate font-medium">{auth.data.user?.email}</div>
          {auth.data.mode === "authenticated" ? (
            <div className="mt-1 flex items-center justify-between">
              <Button variant="ghost" className="!px-0 text-xs text-gray-500 hover:text-red-600" onClick={logout}>
                {t("nav.signOut", "Sign out")}
              </Button>
              <button
                type="button"
                onClick={toggleLang}
                className="text-[11px] text-gray-400 hover:text-indigo-600"
              >
                {lang === "zh" ? "English" : "中文"}
              </button>
            </div>
          ) : (
            <div className="mt-1 text-amber-600">{t("nav.localOnly", "local-only mode")}</div>
          )}
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <Shell>{children}</Shell>
      </I18nProvider>
    </QueryClientProvider>
  );
}
