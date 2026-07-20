import { pageMetadata } from "@/lib/seo";
import { ru } from "@/lib/i18n/ru";
import SeoContentPage from "@/components/landing/seo-content-page";
import { MEDIA } from "@/components/landing/media";

export const metadata = pageMetadata({
  title: "Готовитесь к ремонту? Начните с брифа",
  description:
    "Заполните бриф по своему проекту и пригласите дизайнера или прораба — они увидят задачу целиком. Бесплатно.",
  path: "/for-clients",
});

export default function ForClientsPage() {
  return <SeoContentPage data={ru.seo.forClients} heroMedia={MEDIA.clientBrief} heroAlt="Клиентский бриф — демонстрация" />;
}
