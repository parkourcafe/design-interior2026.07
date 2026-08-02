import { intentPageMetadata } from "@/lib/seo/page-metadata";
import IntentPage from "@/components/landing/intent-page";
import { ruIntentsPro } from "@/lib/i18n/ru-intents-pro";

// Интент DESIGNER_003 из реестра. Маршрут и обоснование — lib/seo/intents.ts.
const data = ruIntentsPro.DESIGNER_003;

export const metadata = intentPageMetadata({
  title: data.h1,
  description: data.sub,
  path: "/guides/pricing",
});

export default function Page() {
  return <IntentPage data={data} />;
}
