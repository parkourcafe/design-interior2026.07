import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Программа для дизайнера интерьера — ARHIDOM";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogImage({ title: "Программа для дизайнера интерьера: бриф, риски, КП" });
}
