import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";

interface FlowRow {
  id: string;
  name: string;
  status: string;
  updated_at: string;
}

export function DashboardPage() {
  const { t } = useTranslation();
  const flows = useQuery({
    queryKey: ["flows"],
    queryFn: () => api<FlowRow[]>("/flows"),
  });
  const status = useQuery({
    queryKey: ["system"],
    queryFn: () => api<{ workers: { id: string; status: string }[] }>("/system/status"),
  });

  return (
    <section className="page">
      <header className="page-head">
        <h1>{t("nav.dashboard")}</h1>
        <Link to="/flows/new" className="primary">
          {t("flows.create")}
        </Link>
      </header>
      <div className="grid-2">
        <article className="panel">
          <h2>{t("flows.title")}</h2>
          <ul className="list">
            {(flows.data ?? []).map((flow) => (
              <li key={flow.id}>
                <Link to={`/flows/${flow.id}`}>{flow.name}</Link>
                <span className="muted">{flow.status}</span>
              </li>
            ))}
          </ul>
        </article>
        <article className="panel">
          <h2>{t("nav.system")}</h2>
          <p>
            {t("system.workers")}: {status.data?.workers.length ?? 0}
          </p>
        </article>
      </div>
    </section>
  );
}
