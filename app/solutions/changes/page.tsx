import { pageMetadata } from "@/lib/seo";
import { ru } from "@/lib/i18n/ru";
import SeoContentPage from "@/components/landing/seo-content-page";
import { MEDIA } from "@/components/landing/media";

export const metadata = pageMetadata({
  title: "Контроль изменений в дизайн-проекте",
  description:
    "Запрос клиента, риски и КП — в одном потоке. Решения проекта перестают теряться в переписке и файлах.",
  path: "/solutions/changes",
});

export default function SolutionsChangesPage() {
  return <SeoContentPage data={ru.seo.changes} heroMedia={MEDIA.ownership} heroAlt="Контроль изменений — демонстрация" />;
}
