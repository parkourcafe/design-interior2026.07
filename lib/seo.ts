import type { Metadata } from "next";
import { ru } from "@/lib/i18n/ru";

// Хелпер метаданных для маркетинговых страниц: уникальные title/description +
// canonical + OpenGraph/Twitter одной строкой (правило publication gate).
//
// Путь A по OG (документ 28): картинку даёт файловая конвенция
// app/<route>/opengraph-image.tsx — поэтому здесь `images` НЕ задаём,
// чтобы og:image/twitter:image не задваивались.
export function pageMetadata(opts: {
  title: string;
  description: string;
  path: string; // канонический путь, напр. "/designers"
  noindex?: boolean;
}): Metadata {
  const { title, description, path, noindex } = opts;
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
    },
    twitter: { card: "summary_large_image", title, description },
    ...(noindex ? { robots: { index: false, follow: false } } : null),
  };
}
