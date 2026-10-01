import type { Metadata, Viewport } from "next";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/golos-text/400.css";
import "@fontsource/golos-text/500.css";
import "@fontsource/golos-text/600.css";
import "./globals.css";
import { ru } from "@/lib/i18n/ru";
import { appUrl } from "@/lib/env";
import Pwa from "@/components/pwa";

export const metadata: Metadata = {
  // Нужен для корректного резолва canonical/OG (относительные пути) — без
  // него Next предупреждает при сборке и абсолютные URL строит неверно.
  metadataBase: new URL(appUrl()),
  title: `${ru.app.name} — ${ru.app.tagline}`,
  description: ru.app.heroSub,
  // Canonical и og:url задаёт КАЖДАЯ страница отдельно, а не корневой layout:
  // метаданные наследуются вниз по сегментам, поэтому canonical="/" здесь
  // объявил бы главную канонической для /studios, /support, /legal/* и всех
  // будущих страниц — то есть сказал бы поиску, что это дубли главной.
  // Общими остаются только те поля OG, которые верны для любой страницы.
  openGraph: {
    type: "website",
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
  robots: { index: true, follow: true }, // дефолт для публичного; приватное переопределяет
};

export const viewport: Viewport = {
  // Совпадает с manifest.theme_color: приложение открывается на тёмной главной.
  themeColor: "#14110d",
};

const mediaFromCdn = !(process.env.NEXT_PUBLIC_MEDIA_BASE ?? "").startsWith("/");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        {/* Шрифты — со своего сервера (@fontsource, импорт выше): браузер клиента не
            обращается к Google Fonts. Медиа лендинга — с CDN, только если не
            выложены рядом с сайтом (NEXT_PUBLIC_MEDIA_BASE=/landing). */}
        {mediaFromCdn && (
          <link rel="preconnect" href="https://d8j0ntlcm91z4.cloudfront.net" crossOrigin="anonymous" />
        )}
      </head>
      <body className="min-h-screen antialiased">
        {children}
        <Pwa />
      </body>
    </html>
  );
}
