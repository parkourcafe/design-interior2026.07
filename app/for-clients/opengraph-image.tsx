import { ogImage, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og";

export const alt = "Готовитесь к ремонту? Начните с брифа — ARHIDOM";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return ogImage({ title: "Готовитесь к ремонту? Начните с брифа", eyebrow: "Заказчику" });
}
