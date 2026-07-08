import type { MetadataRoute } from "next";
import { ru } from "@/lib/i18n/ru";
import { MEDIA } from "@/components/landing/media";

// Тип screenshots в Next 14 не знает про form_factor/label (они есть в спеке
// PWA и нужны магазинам), поэтому массив ассертим на его собственный тип ниже.

// Web App Manifest — готов под установку и под упаковку в Android-приложение
// (TWA: Google Play + RuStore через Bubblewrap/PWABuilder). См. STORE_SETUP.md.
// Все видимые строки — из lib/i18n/ru.ts (guardrail).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${ru.app.name} — ${ru.pwa.appName}`,
    short_name: ru.app.name,
    description: ru.pwa.description,
    // Открываемся на публичной главной: витрина видна без входа (важно для
    // ревью сторов). Дизайнер уходит в кабинет кнопкой на главной.
    start_url: "/?utm_source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    dir: "ltr",
    lang: "ru",
    categories: ["business", "productivity"],
    background_color: "#14110d",
    theme_color: "#14110d",
    prefer_related_applications: false,
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      // Full-bleed фон → безопасно как maskable (Android обрежет углы).
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      {
        src: MEDIA.heroPoster,
        sizes: "2752x1536",
        type: "image/png",
        form_factor: "wide",
        label: ru.pwa.shots.hero,
      },
      {
        src: MEDIA.review,
        sizes: "2752x1536",
        type: "image/png",
        form_factor: "wide",
        label: ru.pwa.shots.review,
      },
      {
        src: MEDIA.passport,
        sizes: "1856x2304",
        type: "image/png",
        form_factor: "narrow",
        label: ru.pwa.shots.passport,
      },
      {
        src: MEDIA.clientBrief,
        sizes: "2752x1536",
        type: "image/png",
        form_factor: "narrow",
        label: ru.pwa.shots.brief,
      },
    ] as unknown as MetadataRoute.Manifest["screenshots"],
  };
}
