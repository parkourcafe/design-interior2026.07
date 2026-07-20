import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// robots.txt через Metadata Files API. Разрешаем публичное, закрываем
// приватное (клиентские данные/ПДн, кабинет, API), указываем sitemap.
// Это НЕ авторизация: приватные страницы дополнительно noindex + за Supabase-auth.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/login", "/auth/", "/dashboard/", "/i/", "/p/", "/b/", "/api/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
