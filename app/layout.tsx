import type { Metadata } from "next";
import "./globals.css";
import { ru } from "@/lib/i18n/ru";

export const metadata: Metadata = {
  title: ru.app.name,
  description: ru.app.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
