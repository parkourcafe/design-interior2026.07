"use client";

import { PUBLIC_LOCALES, usePublicLocale, type PublicLocale } from "@/lib/i18n/public";

const LABELS: Record<PublicLocale, string> = { ru: "RU", en: "EN", id: "ID" };

export default function LanguageSwitcher() {
  const { locale, setLocale } = usePublicLocale();

  return (
    <div className="flex items-center rounded-lg border border-linedark bg-coal/65 p-0.5" aria-label="Language">
      {PUBLIC_LOCALES.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => setLocale(item)}
          aria-pressed={locale === item}
          className={`min-h-8 rounded-md px-2 text-[11px] font-semibold tracking-[0.08em] transition-colors ${
            locale === item ? "bg-ivory text-coal" : "text-ivorymuted hover:text-ivory"
          }`}
        >
          {LABELS[item]}
        </button>
      ))}
    </div>
  );
}
