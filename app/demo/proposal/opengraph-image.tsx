import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Генератор КП для дизайнера интерьера — ARHIDOM";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogImage({ title: "Генератор КП для дизайнера интерьера" });
}
