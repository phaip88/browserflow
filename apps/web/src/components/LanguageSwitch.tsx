import { useTranslation } from "react-i18next";
import { useLocaleStore, type Locale } from "../state/locale";

export function LanguageSwitch() {
  const { t } = useTranslation();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  return (
    <div className="lang" role="group" aria-label="Language">
      {(["en", "zh"] as Locale[]).map((code) => (
        <button
          key={code}
          type="button"
          className={locale === code ? "lang-btn active" : "lang-btn"}
          onClick={() => setLocale(code)}
        >
          {t(`language.${code}`)}
        </button>
      ))}
    </div>
  );
}
