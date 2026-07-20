import { pageMetadata } from "@/lib/seo";
import { ru } from "@/lib/i18n/ru";
import SeoContentPage from "@/components/landing/seo-content-page";

// noindex: страница ждёт фактчека по конкретному продукту (Teroom) перед
// публикацией и намеренно исключена из sitemap. Контент — на уровне категорий,
// без непроверенных утверждений о чужих возможностях.
export const metadata = pageMetadata({
  title: "ARHIDOM или Teroom: в чём разница",
  description:
    "CRM ведёт студию и сделки, ARHIDOM — пресейл: бриф клиента, риски и КП до сделки. Когда что нужнее.",
  path: "/compare/teroom-vs-arhidom",
  noindex: true,
});

export default function CompareTeroomPage() {
  return <SeoContentPage data={ru.seo.compareTeroom} />;
}
