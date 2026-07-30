"use client";

import { PUBLIC_LOCALES, usePublicLocale, type PublicLocale } from "@/lib/i18n/public";

const LABELS: Record<PublicLocale, string> = {
  ru: "Русский",
  en: "English",
  id: "Bahasa Indonesia",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
  pt: "Português",
  it: "Italiano",
  ar: "العربية",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
};

export default function LanguageSwitcher() {
  const { locale, setLocale } = usePublicLocale();

  return (
    <label className="block">
      <span className="sr-only">Language</span>
      <select
        value={locale}
        onChange={(event) => setLocale(event.target.value as PublicLocale)}
        className="min-h-9 max-w-[170px] rounded-lg border border-linedark bg-coal/80 px-2.5 text-[12px] font-medium text-ivory outline-none focus:border-bronze"
      >
        {PUBLIC_LOCALES.map((item) => (
          <option key={item} value={item}>{LABELS[item]}</option>
        ))}
      </select>
    </label>
  );
}
