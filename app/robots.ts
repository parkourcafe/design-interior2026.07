import type { MetadataRoute } from "next";

const site = "https://remhaos.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/demo", "/demo/brief", "/demo/proposal", "/designers", "/studios", "/pilot", "/security", "/legal/privacy", "/legal/terms"],
        disallow: ["/dashboard", "/dashboard/", "/i/", "/b/", "/p/", "/auth/"],
      },
    ],
    sitemap: "https://remhaos.com/sitemap.xml",
    host: site,
  };
}
