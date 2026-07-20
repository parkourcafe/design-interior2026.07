import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "ARHIDOM или CRM для студии — в чём разница";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogImage({ title: "ARHIDOM или CRM для студии: в чём разница", eyebrow: "Сравнение" });
}
