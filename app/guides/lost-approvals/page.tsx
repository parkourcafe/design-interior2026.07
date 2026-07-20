import { pageMetadata } from "@/lib/seo";
import { ru } from "@/lib/i18n/ru";
import SeoContentPage from "@/components/landing/seo-content-page";

export const metadata = pageMetadata({
  title: "Почему теряются согласования в дизайн-проекте",
  description:
    "Где рвётся цепочка решений между дизайнером, клиентом и подрядчиком — и как перестать терять договорённости.",
  path: "/guides/lost-approvals",
});

export default function GuideLostApprovalsPage() {
  return <SeoContentPage data={ru.seo.guideLostApprovals} />;
}
