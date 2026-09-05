import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

const LINKS = [
  ["/", "nav.dashboard"],
  ["/executions", "nav.executions"],
  ["/schedules", "nav.schedules"],
  ["/credentials", "nav.credentials"],
  ["/identities", "nav.identities"],
  ["/templates", "nav.templates"],
  ["/settings", "nav.settings"],
  ["/system", "nav.system"],
] as const;

export function Nav() {
  const { t } = useTranslation();
  return (
    <nav className="nav">
      {LINKS.map(([to, key]) => (
        <NavLink key={to} to={to} end={to === "/"}>
          {t(key)}
        </NavLink>
      ))}
    </nav>
  );
}
