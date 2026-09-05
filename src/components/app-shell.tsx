"use client";
import React, { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { api, queryClient, setCsrfToken, type AuthStatus } from "@/lib/api";
import { Button, Spinner } from "./ui";

const NAV = [["/", "Dashboard"], ["/flows", "Flows"], ["/executions", "Executions"], ["/schedules", "Schedules"], ["/credentials", "Credentials"], ["/identities", "Identities"], ["/templates", "Templates"], ["/settings", "Settings"], ["/system", "System"]] as const;

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
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
  return (
    <div className="flex min-h-screen bg-gray-50">
      <aside className="flex w-52 shrink-0 flex-col border-r border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-4 py-3"><Link href="/" className="text-lg font-bold text-indigo-700">BrowserFlow</Link><div className="text-[10px] uppercase tracking-wide text-gray-400">single-user · self-hosted</div></div>
        <nav className="flex-1 space-y-0.5 p-2">{NAV.map(([href, label]) => <Link key={href} href={href} className={`block rounded px-3 py-1.5 text-sm ${pathname === href || (href !== "/" && pathname.startsWith(href)) ? "bg-indigo-50 font-medium text-indigo-700" : "text-gray-700 hover:bg-gray-100"}`}>{label}</Link>)}</nav>
        <div className="border-t border-gray-100 p-3 text-xs text-gray-500"><div className="truncate">{auth.data.user?.email}</div>{auth.data.mode === "authenticated" ? <Button variant="ghost" className="mt-1 !px-0" onClick={logout}>Sign out</Button> : <div className="mt-1 text-amber-600">local-only mode</div>}</div>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  );
}
export function AppProviders({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}><Shell>{children}</Shell></QueryClientProvider>;
}
