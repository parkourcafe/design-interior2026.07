import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ru } from "@/lib/i18n/ru";
import Pwa from "@/components/pwa";

const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://remhaos.com";
if (
  process.env.NODE_ENV === "production" &&
  process.env.VERCEL_ENV !== "preview" &&
  /(?:vercel\.app|arhidom\.space)$/i.test(new URL(siteUrl).hostname)
) {
  throw new Error("Production metadata host must be https://remhaos.com, not a preview or legacy host.");
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: `${ru.app.name} — ${ru.app.tagline}`,
  description: ru.app.heroSub,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: ru.app.name,
    title: `${ru.app.name} — ${ru.app.tagline}`,
    description: ru.app.heroSub,
  },
  twitter: {
    card: "summary_large_image",
    title: `${ru.app.name} — ${ru.app.tagline}`,
    description: ru.app.heroSub,
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: ru.app.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Совпадает с manifest.theme_color: приложение открывается на тёмной главной.
  themeColor: "#14110d",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        {/* Шрифты подгружаются в рантайме (Cormorant Garamond — заголовки, Golos Text — текст). */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* CDN с медиа лендинга — заранее устанавливаем соединение. */}
        <link rel="preconnect" href="https://d8j0ntlcm91z4.cloudfront.net" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout: applies globally */}
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600&family=Golos+Text:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <Pwa />
      </body>
    </html>
  );
}
