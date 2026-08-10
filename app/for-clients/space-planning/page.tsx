import { intentPageMetadata } from "@/lib/seo/page-metadata";
import IntentPage from "@/components/landing/intent-page";
import { ruIntentsClient } from "@/lib/i18n/ru-intents-client";

// Интент CLIENT_006 из реестра. Маршрут и обоснование — lib/seo/intents.ts.
const data = ruIntentsClient.CLIENT_006;

export const metadata = intentPageMetadata({
  title: data.h1,
  description: data.sub,
  path: "/for-clients/space-planning",
});

export default function Page() {
  return <IntentPage data={data} />;
}
