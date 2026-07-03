import type { MetadataRoute } from "next";
import { ru } from "@/lib/i18n/ru";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${ru.app.name} — ${ru.app.tagline}`,
    short_name: ru.app.name,
    description: ru.app.hero,
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#9c4a28",
    lang: "ru",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
