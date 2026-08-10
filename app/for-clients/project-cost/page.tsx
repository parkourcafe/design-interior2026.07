import { intentPageMetadata } from "@/lib/seo/page-metadata";
import IntentPage from "@/components/landing/intent-page";
import { ruIntentsClient } from "@/lib/i18n/ru-intents-client";

// Интент CLIENT_002 из реестра. Маршрут и обоснование — lib/seo/intents.ts.
const data = ruIntentsClient.CLIENT_002;

export const metadata = intentPageMetadata({
  title: data.h1,
  description: data.sub,
  path: "/for-clients/project-cost",
});

export default function Page() {
  return <IntentPage data={data} />;
}
