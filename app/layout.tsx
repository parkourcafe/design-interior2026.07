import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ru } from "@/lib/i18n/ru";
import { appUrl } from "@/lib/env";
import Pwa from "@/components/pwa";
import { OG_IMAGE, SITE_TITLE, organizationJsonLd } from "@/lib/seo/site";

export const metadata: Metadata = {
  // Нужен для корректного резолва canonical/OG (относительные пути) — без
  // него Next предупреждает при сборке и абсолютные URL строит неверно.
  metadataBase: new URL(appUrl()),
  title: SITE_TITLE,
  description: ru.app.heroSub,
  // Canonical и og:url задаёт КАЖДАЯ страница отдельно, а не корневой layout:
  // метаданные наследуются вниз по сегментам, поэтому canonical="/" здесь
  // объявил бы главную канонической для /studios, /support, /legal/* и всех
  // будущих страниц — то есть сказал бы поиску, что это дубли главной.
  // Общими остаются только те поля OG, которые верны для любой страницы.
  // Страницы с собственным openGraph заменяют этот объект целиком (см.
  // lib/seo/site.ts) — поэтому публичные страницы строят его через
  // publicPageMetadata/intentPageMetadata, где картинка тоже есть.
  openGraph: {
    type: "website",
    siteName: ru.app.name,
    title: SITE_TITLE,
    description: ru.app.heroSub,
    images: [OG_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: ru.app.heroSub,
    images: [OG_IMAGE.url],
  },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: ru.app.name, statusBarStyle: "default" },
  robots: { index: true, follow: true }, // дефолт для публичного; приватное переопределяет
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
        <script
          type="application/ld+json"
          // Статичный объект из lib/seo/site.ts, пользовательских данных нет.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd()) }}
        />
        {children}
        <Pwa />
      </body>
    </html>
  );
}
