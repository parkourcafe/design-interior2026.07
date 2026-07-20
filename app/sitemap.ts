import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

type Route = {
  path: string;
  priority: number;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
};

// Только публичные индексируемые маршруты. Токен-страницы (/i, /p, /b),
// кабинет (/dashboard), /login, /auth, /api — намеренно исключены (ПДн/приватка).
// /compare/teroom-vs-arhidom исключён намеренно: ждёт фактчека по Teroom (noindex).
const ROUTES: Route[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/designers", priority: 0.9, changeFrequency: "monthly" },
  { path: "/studios", priority: 0.8, changeFrequency: "monthly" },
  { path: "/demo", priority: 0.7, changeFrequency: "monthly" },
  { path: "/demo/brief", priority: 0.8, changeFrequency: "monthly" },
  { path: "/demo/proposal", priority: 0.8, changeFrequency: "monthly" },
  { path: "/product/passport", priority: 0.8, changeFrequency: "monthly" },
  { path: "/solutions/changes", priority: 0.7, changeFrequency: "monthly" },
  { path: "/guides/lost-approvals", priority: 0.6, changeFrequency: "monthly" },
  { path: "/guides/client-changes", priority: 0.6, changeFrequency: "monthly" },
  { path: "/guides/budget-overrun", priority: 0.6, changeFrequency: "monthly" },
  { path: "/for-clients", priority: 0.6, changeFrequency: "monthly" },
  { path: "/pilot", priority: 0.6, changeFrequency: "monthly" },
  { path: "/security", priority: 0.4, changeFrequency: "yearly" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return ROUTES.map((r) => ({
    url: `${SITE_URL}${r.path === "/" ? "" : r.path}`,
    lastModified,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
