/** @type {import('next').NextConfig} */
const SITE_HOST = "arhidom.space";

const nextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: process.cwd(),
  },
  // Шрифты OG-картинок (next/og) читаются с диска в рантайме — включаем их
  // в трассировку, чтобы файлы попали в serverless-функцию на Vercel.
  outputFileTracingIncludes: {
    "/**": ["./app/_fonts/**"],
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
    ];
  },
  async redirects() {
    return [
      // www → апекс, 301 (в Vercel также выставить апекс Primary Domain).
      {
        source: "/:path*",
        has: [{ type: "host", value: `www.${SITE_HOST}` }],
        destination: `https://${SITE_HOST}/:path*`,
        permanent: true,
      },
    ];
  },
  async headers() {
    // X-Robots-Tag на приватное сверх robots.txt (внешние ссылки на /i, /p, /b).
    const noindex = { key: "X-Robots-Tag", value: "noindex, nofollow" };
    return [
      { source: "/dashboard", headers: [noindex] },
      { source: "/dashboard/:path*", headers: [noindex] },
      { source: "/i/:path*", headers: [noindex] },
      { source: "/p/:path*", headers: [noindex] },
      { source: "/b/:path*", headers: [noindex] },
      { source: "/api/:path*", headers: [noindex] },
      { source: "/login", headers: [noindex] },
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
