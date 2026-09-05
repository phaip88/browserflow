import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";

export function SimpleListPage({ kind }: { kind: string }) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: [kind],
    queryFn: () => api<unknown>(`/${kind}`),
  });
  return (
    <section className="page">
      <h1>{t(`nav.${kind.split("/")[0]}`)}</h1>
      <pre className="panel code">{JSON.stringify(query.data ?? query.error ?? {}, null, 2)}</pre>
    </section>
  );
}
