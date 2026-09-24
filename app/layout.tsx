import type { Metadata, Viewport } from "next";
import Script from "next/script";
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
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-JSHYCJDNTH"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-JSHYCJDNTH');`}
        </Script>
      </body>
    </html>
  );
}
