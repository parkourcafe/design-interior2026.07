import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ru } from "@/lib/i18n/ru";
import Pwa from "@/components/pwa";

export const metadata: Metadata = {
  title: `${ru.app.name} — ${ru.app.tagline}`,
  description: ru.app.heroSub,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: ru.app.name, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#9c4a28",
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
