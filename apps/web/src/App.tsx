import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { LanguageSwitch } from "./components/LanguageSwitch";
import { Nav } from "./components/Nav";
import { DashboardPage } from "./pages/DashboardPage";
import { FlowEditorPage } from "./pages/FlowEditorPage";
import { LoginPage } from "./pages/LoginPage";
import { SimpleListPage } from "./pages/SimpleListPage";
import { useLocaleStore } from "./state/locale";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  const { i18n } = useTranslation();
  const locale = useLocaleStore((s) => s.locale);

  useEffect(() => {
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale, i18n]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="shell">
          <header className="topbar">
            <div className="brand">
              <span className="mark" aria-hidden="true" />
              <strong>BrowserFlow</strong>
            </div>
            <Nav />
            <LanguageSwitch />
          </header>
          <main>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/" element={<DashboardPage />} />
              <Route path="/flows/:flowId" element={<FlowEditorPage />} />
              <Route path="/executions" element={<SimpleListPage kind="executions" />} />
              <Route path="/schedules" element={<SimpleListPage kind="schedules" />} />
              <Route path="/credentials" element={<SimpleListPage kind="credentials" />} />
              <Route path="/identities" element={<SimpleListPage kind="identities" />} />
              <Route path="/templates" element={<SimpleListPage kind="templates" />} />
              <Route path="/settings" element={<SimpleListPage kind="settings" />} />
              <Route path="/system" element={<SimpleListPage kind="system/status" />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
