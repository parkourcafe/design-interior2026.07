import type { Metadata } from "next";

// Страница входа — вне индекса. Метаданные заданы в layout, потому что
// сама page.tsx — клиентский компонент ("use client") и metadata экспортировать не может.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
