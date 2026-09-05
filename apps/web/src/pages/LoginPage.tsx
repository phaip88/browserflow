import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { fetchLiveHealth } from "../api/health";

export function LoginPage() {
  const { t } = useTranslation();
  const health = useQuery({ queryKey: ["health", "live"], queryFn: fetchLiveHealth });

  return (
    <section className="panel auth-panel">
      <h1>{t("login.title")}</h1>
      <p className="muted">{t("login.subtitle")}</p>
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label>
          {t("login.email")}
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label>
          {t("login.password")}
          <input name="password" type="password" autoComplete="current-password" required />
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
