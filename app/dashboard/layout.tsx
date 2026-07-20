import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudio } from "@/lib/studio";
import { ru } from "@/lib/i18n/ru";
import SignOutButton from "./sign-out-button";

export const dynamic = "force-dynamic";

// Кабинет за авторизацией — вне индекса (сверх X-Robots-Tag/robots.txt).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const studio = await getStudio();
  if (!studio) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <Link href="/dashboard" className="flex items-baseline gap-2">
            <span className="font-display text-xl font-semibold">{ru.app.name}</span>
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted">{ru.app.tagline}</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="text-muted hover:text-ink">
              {ru.nav.projects}
            </Link>
            <Link href="/dashboard/analytics" className="text-muted hover:text-ink">
              {ru.nav.analytics}
            </Link>
            <Link href="/dashboard/setup" className="text-muted hover:text-ink">
              {ru.nav.setup}
            </Link>
            <SignOutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
