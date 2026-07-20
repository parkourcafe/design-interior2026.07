import { pageMetadata } from "@/lib/seo";
import { ru } from "@/lib/i18n/ru";
import SeoContentPage from "@/components/landing/seo-content-page";

export const metadata = pageMetadata({
  title: "Перерасход бюджета в дизайн-проекте: где течёт",
  description:
    "Типовые зоны потери бюджета проекта и на каких стадиях это видно заранее. Разбор без общих слов.",
  path: "/guides/budget-overrun",
});

export default function GuideBudgetOverrunPage() {
  return <SeoContentPage data={ru.seo.guideBudgetOverrun} />;
}
