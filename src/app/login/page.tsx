"use client";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api, queryClient, setCsrfToken, type AuthStatus } from "@/lib/api";
import { Button, Card, ErrorText, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
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
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-bold text-indigo-700">BrowserFlow</h1>
        <p className="mb-4 text-center text-sm text-gray-500">{setup ? "Create the administrator account" : "Sign in to continue"}</p>
        <Card>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
            <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Password" help={setup ? "At least 12 characters with 3 of: lowercase, uppercase, digits, symbols" : undefined}><Input type="password" autoComplete={setup ? "new-password" : "current-password"} required minLength={setup ? 12 : 1} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <ErrorText error={m.error} />
            <Button type="submit" className="w-full" disabled={m.isPending || status.isLoading}>{m.isPending ? "Please wait…" : setup ? "Initialize administrator" : "Sign in"}</Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
