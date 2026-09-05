import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { fetchLiveHealth } from "../api/health";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@example.com");
  const [password, setPassword] = useState("");
  const health = useQuery({ queryKey: ["health", "live"], queryFn: fetchLiveHealth });
  const login = useMutation({
    mutationFn: () =>
      api("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
    onSuccess: () => navigate("/"),
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    login.mutate();
  }

  return (
    <section className="panel auth-panel">
      <h1>{t("login.title")}</h1>
      <p className="muted">{t("login.subtitle")}</p>
      <form className="stack" onSubmit={onSubmit}>
        <label>
          {t("login.email")}
          <input
            name="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          {t("login.password")}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button type="submit" className="primary">
          {t("login.submit")}
        </button>
      </form>
      <p className={health.data?.status === "ok" ? "health ok" : "health"}>
        {t("login.health")}:{" "}
        {health.isLoading
          ? t("common.loading")
          : health.data?.status === "ok"
            ? t("login.healthOk")
            : t("login.healthFail")}
      </p>
    </section>
  );
}
