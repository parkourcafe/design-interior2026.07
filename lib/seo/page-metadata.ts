import type { Metadata } from "next";
import { ru } from "@/lib/i18n/ru";

// Метаданные интент-страниц: уникальные title/description + canonical.
// Бренд к title не дописываем здесь — существующие страницы делают это сами
// (`${title} — ${ru.app.name}`), и шаблона в layout нет, поэтому дублирования
// не возникает только при явной сборке.
export function intentPageMetadata(opts: {
  title: string;
  description: string;
  /** Канонический путь, напр. "/guides/pricing". Без домена. */
  path: string;
  noindex?: boolean;
}): Metadata {
  const { title, description, path, noindex } = opts;
  const fullTitle = `${title} — ${ru.app.name}`;
  return {
    title: fullTitle,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      locale: "ru_RU",
      url: path,
      siteName: ru.app.name,
      title: fullTitle,
      description,
    },
    twitter: { card: "summary_large_image", title: fullTitle, description },
    ...(noindex ? { robots: { index: false, follow: false } } : null),
  };
}
