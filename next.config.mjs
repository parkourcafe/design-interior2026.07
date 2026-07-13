/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    ];
  },
};

export default nextConfig;
