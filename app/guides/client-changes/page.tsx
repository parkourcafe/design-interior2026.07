import { pageMetadata } from "@/lib/seo";
import { ru } from "@/lib/i18n/ru";
import SeoContentPage from "@/components/landing/seo-content-page";

export const metadata = pageMetadata({
  title: "Как учитывать изменения заказчика в проекте",
  description:
    "Правка после утверждения ломает смету и сроки. Как фиксировать изменения, чтобы они дошли до всех документов.",
  path: "/guides/client-changes",
});

export default function GuideClientChangesPage() {
  return <SeoContentPage data={ru.seo.guideClientChanges} />;
}
