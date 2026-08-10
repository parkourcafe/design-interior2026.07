import { intentPageMetadata } from "@/lib/seo/page-metadata";
import IntentPage from "@/components/landing/intent-page";
import { ruIntentsPro } from "@/lib/i18n/ru-intents-pro";

// Интент DESIGNER_007 из реестра. Маршрут и обоснование — lib/seo/intents.ts.
const data = ruIntentsPro.DESIGNER_007;

export const metadata = intentPageMetadata({
  title: data.h1,
  description: data.sub,
  path: "/studios/process-standards",
});

export default function Page() {
  return <IntentPage data={data} />;
}
