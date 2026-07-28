import type { MetadataRoute } from "next";

const site = "https://remhaos.com";

const publicRoutes = [
  "",
  "/demo",
  "/demo/brief",
  "/demo/proposal",
  "/designers",
  "/studios",
  "/pilot",
  "/security",
  "/legal/privacy",
  "/legal/terms",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return publicRoutes.map((route) => ({
    url: `${site}${route}`,
    lastModified: new Date("2026-07-28T00:00:00.000Z"),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7,
  }));
}
