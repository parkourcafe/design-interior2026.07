import { pageMetadata } from "@/lib/seo";
import { ru } from "@/lib/i18n/ru";
import SeoContentPage from "@/components/landing/seo-content-page";
import { MEDIA } from "@/components/landing/media";

export const metadata = pageMetadata({
  title: "Паспорт проекта интерьера",
  description:
    "Единая карта проекта: требования, бюджет, риски, решения. То, что теряется в переписке, — в одном месте.",
  path: "/product/passport",
});

export default function ProductPassportPage() {
  return <SeoContentPage data={ru.seo.passport} heroMedia={MEDIA.passport} heroAlt="Паспорт проекта — демонстрация" />;
}
