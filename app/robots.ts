import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";

// robots.txt через Metadata Files API. Разрешаем публичное (лендинг,
// ролевые/demo/юр. страницы), закрываем всё, что несёт клиентские данные,
// суммы или требует аутентификации. Это НЕ единственная защита — приватные
// роуты дополнительно noindex в metadata и X-Robots-Tag в next.config.mjs
// (robots.txt не гарантирует отсутствие индексации по внешним ссылкам).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/login",
          "/auth/",
          "/dashboard/",
          "/app", // мобильная точка входа — всегда редирект, индексировать нечего
          "/i/", // клиентский бриф — ПДн
          "/p/", // публичное КП — суммы + ПДн
          "/b/", // ссылка-бриф для рассылки дизайнерам — ПДн
          "/join/", // приглашение в студию — токен
          "/room/", // участник Project Room — токен + задачи проекта
          "/projectceo/", // guest/invitation токен-роуты ProjectCEO
          "/projectceo-qa/", // локальный QA-харнесс, в проде и так недоступен
          "/api/",
        ],
      },
    ],
    sitemap: `${appUrl()}/sitemap.xml`,
  };
}
