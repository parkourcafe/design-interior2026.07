// Канонический origin публичного сайта (ADR-0005: www.remhaos.com). Тот же
// фолбэк, что у appUrl() в lib/env.ts; next.config не может импортировать TS.
const CANONICAL_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || "https://www.remhaos.com").replace(/\/$/, "");

// ADR-0005: старый домен должен перенаправлять на новый. Раньше arhidom.space
// отдавал тот же контент с кодом 200 — дубль для поиска. 301 с сохранением
// пути и query. Исключения — то, что ломается при смене origin:
//   /api/*        — POST/JSON-клиенты (в т.ч. приложения), 301 превращает POST в GET;
//   /auth/*       — magic-link/PKCE: cookie code verifier живёт на старом origin;
//   /.well-known/* — AASA/assetlinks проверяются на каждом hostname отдельно.
// Если NEXT_PUBLIC_APP_URL сам указывает на arhidom.space, правило не
// создаётся — иначе получился бы редирект-цикл.
export const LEGACY_HOST_PATTERN = "(?:www\\.)?arhidom\\.space";
export function legacyHostRedirects(canonicalOrigin = CANONICAL_ORIGIN) {
  if (/arhidom\.space/i.test(canonicalOrigin)) return [];
  return [
    {
      source: "/:path((?!api/|api$|auth/|auth$|\\.well-known/).*)",
      has: [{ type: "host", value: LEGACY_HOST_PATTERN }],
      destination: `${canonicalOrigin}/:path`,
      statusCode: 301,
    },
  ];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Local release checks can use `.next.nosync` to avoid iCloud conflict
  // copies while production keeps the standard `.next` default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Сборка для своего сервера (Dockerfile): самодостаточный server.js.
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  turbopack: {
    root: process.cwd(),
  },
  images: {
    // Оптимизатор Next отдаёт webp/avif и правильный размер под экран.
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "d8j0ntlcm91z4.cloudfront.net",
      },
    ],
  },
  async redirects() {
    return legacyHostRedirects();
  },
  async rewrites() {
    return [
      // Digital Asset Links для TWA (Google Play / RuStore) —
      // стандартный путь /.well-known/... обслуживает env-driven роут.
      { source: "/.well-known/assetlinks.json", destination: "/api/assetlinks" },
      { source: "/.well-known/apple-app-site-association", destination: "/api/apple-app-site-association" },
    ];
  },
  async headers() {
    // X-Robots-Tag на приватное сверх robots.txt и noindex в metadata —
    // защита от индексации по внешним ссылкам (robots.txt её не даёт).
    // /projectceo/guest и /projectceo/invitations уже ставят этот заголовок
    // сами (route.ts/metadata); повтор здесь — вторая линия защиты, безвреден.
    const noindex = { key: "X-Robots-Tag", value: "noindex, nofollow" };
    return [
      { source: "/dashboard", headers: [noindex] },
      { source: "/dashboard/:path*", headers: [noindex] },
      { source: "/i/:path*", headers: [noindex] },
      { source: "/p/:path*", headers: [noindex] },
      { source: "/b/:path*", headers: [noindex] },
      { source: "/join/:path*", headers: [noindex] },
      { source: "/room/:path*", headers: [noindex] },
      { source: "/app", headers: [noindex] },
      { source: "/projectceo/:path*", headers: [noindex] },
      { source: "/projectceo-qa/:path*", headers: [noindex] },
      { source: "/api/:path*", headers: [noindex] },
      { source: "/login", headers: [noindex] },
      { source: "/auth/:path*", headers: [noindex] },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
