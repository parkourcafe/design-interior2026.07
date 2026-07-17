import { headers } from "next/headers";
import { appUrl } from "@/lib/env";

// Базовый URL из заголовков запроса — чтобы публичные ссылки (бриф, КП, шаринг)
// совпадали с доменом, на котором реально открыт сайт (например arhidom.space),
// без зависимости от NEXT_PUBLIC_APP_URL. Только в server-компонентах/роутах.
// Фолбэк — appUrl() из env.
export async function requestBaseUrl(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (host) {
    const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`.replace(/\/$/, "");
  }
  return appUrl();
}
