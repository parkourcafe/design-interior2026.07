// Единый источник базового URL сайта для SEO (robots, sitemap, canonical, OG).
// Приоритет NEXT_PUBLIC_SITE_URL; фолбэк на NEXT_PUBLIC_APP_URL, затем апекс.
// Без завершающего слэша — чтобы конкатенация путей не давала двойной //.
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ??
  process.env.NEXT_PUBLIC_APP_URL ??
  "https://arhidom.space"
).replace(/\/$/, "");
