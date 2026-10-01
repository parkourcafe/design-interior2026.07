import type { Metadata } from "next";
import { ru } from "@/lib/i18n/ru";
import { appUrl } from "@/lib/env";
import { MEDIA } from "@/components/landing/media";

// Общие SEO-атрибуты публичных страниц: og:image, Organization JSON-LD и
// сборка метаданных страницы с canonical/og:url.
//
// Почему страницам нужен полный openGraph, а не только `{ url }`: Next
// сливает метаданные сегментов поверхностно — объект openGraph страницы
// ЗАМЕНЯЕТ объект из корневого layout целиком. `openGraph: { url: "/x" }`
// молча выбрасывал siteName, title, description и картинку.

// Картинка превью — существующий постер героя лендинга (тот же файл уже
// объявлен скриншотом в app/manifest.ts, размер оттуда). Нового ассета нет.
export const OG_IMAGE = {
  url: MEDIA.heroPoster,
  width: 2752,
  height: 1536,
  alt: `${ru.app.name} — ${ru.app.tagline}`,
} as const;

export const SITE_TITLE = `${ru.app.name} — ${ru.app.tagline}`;

export function publicPageMetadata(opts: {
  /** Полный <title>; для главной — SITE_TITLE. */
  title: string;
  description: string;
  /** Канонический путь без домена, напр. "/studios". */
  path: string;
}): Metadata {
  const { title, description, path } = opts;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "ru_RU",
      url: path,
      siteName: ru.app.name,
      title,
      description,
      images: [OG_IMAGE],
    },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}

// Organization JSON-LD — только факты из репозитория: публичное имя бренда,
// канонический URL и логотип (иконка приложения, app/icons/[size]/route.tsx).
// Контакты и соцсети намеренно не указаны: подтверждённых в репозитории нет.
export function organizationJsonLd() {
  const url = appUrl();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: ru.app.name,
    url,
    logo: `${url}/icons/512`,
  };
}
