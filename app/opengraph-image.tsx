import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { ru } from "@/lib/i18n/ru";

export const alt = `${ru.app.name} — ${ru.app.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

// Дефолтная OG-картинка сайта. Наследуется всеми маршрутами без своего
// opengraph-image.tsx. Короткий hero (не heroSub) — чтобы текст помещался в 630px.
export default async function Image() {
  return ogImage({ title: ru.app.hero });
}
