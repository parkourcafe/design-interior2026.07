import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Почему теряются согласования в дизайн-проекте — ARHIDOM";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogImage({ title: "Почему теряются согласования в дизайн-проекте", eyebrow: "Гайд" });
}
