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
};

export default nextConfig;
