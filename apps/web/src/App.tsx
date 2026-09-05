import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { LoginPage } from "./pages/LoginPage";
import { useLocaleStore } from "./state/locale";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  const { t, i18n } = useTranslation();
  const locale = useLocaleStore((s) => s.locale);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale, i18n]);

  const year = useMemo(() => new Date().getFullYear(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <span className="mark" aria-hidden="true" />
              <div>
                <strong>BrowserFlow</strong>
                <div className="muted">{t("app.tagline")}</div>
              </div>
            </div>
            <LanguageSwitch />
          </header>
          <main>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<Navigate to="/login" replace />} />
            </Routes>
          </main>
          <footer className="footer">
            <span>© {year} BrowserFlow</span>
            <span className="muted">{t("app.selfHosted")}</span>
          </footer>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
