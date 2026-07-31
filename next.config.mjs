/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Local release checks can use `.next.nosync` to avoid iCloud conflict
  // copies while production keeps the standard `.next` default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
