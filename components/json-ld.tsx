import { ru } from "@/lib/i18n/ru";
import { SITE_URL } from "@/lib/site";

// Только реальные сущности. Offer НЕ добавляем (закрытый бесплатный пилот,
// тарифов нет). Review/AggregateRating запрещены — нет реальных данных.
export function JsonLd() {
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: ru.app.name,
      url: SITE_URL,
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: ru.app.name,
      url: SITE_URL,
      inLanguage: "ru-RU",
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: ru.app.name,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      inLanguage: "ru-RU",
      description: ru.app.heroSub,
    },
  ];
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
