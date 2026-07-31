import type { MetadataRoute } from "next";
import { appUrl } from "@/lib/env";

type Route = {
  path: string;
  priority: number;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
};

// Только реальные публичные индексируемые маршруты (сверено по факту app/
// на 31.07.2026). Токен-роуты, кабинет, API, ProjectCEO guest/QA — намеренно
// исключены (см. app/robots.ts).
const ROUTES: Route[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/designers", priority: 0.9, changeFrequency: "monthly" },
  { path: "/studios", priority: 0.8, changeFrequency: "monthly" },
  { path: "/demo", priority: 0.7, changeFrequency: "monthly" },
  { path: "/demo/brief", priority: 0.8, changeFrequency: "monthly" },
  { path: "/demo/proposal", priority: 0.8, changeFrequency: "monthly" },
  { path: "/pilot", priority: 0.6, changeFrequency: "monthly" },
  { path: "/security", priority: 0.4, changeFrequency: "yearly" },
  { path: "/support", priority: 0.4, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/terms", priority: 0.3, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  const lastModified = new Date();
  return ROUTES.map((r) => ({
    url: `${base}${r.path === "/" ? "" : r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
