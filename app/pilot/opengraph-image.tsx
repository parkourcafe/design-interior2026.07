import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";
import { ru } from "@/lib/i18n/ru";

export const alt = `${ru.landing.pagePilot.title} — ${ru.app.name}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogImage({ title: ru.landing.pagePilot.title });
}
