import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudio } from "@/lib/studio";
import { ru } from "@/lib/i18n/ru";
import SignOutButton from "./sign-out-button";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const studio = await getStudio();
  if (!studio) redirect("/login");

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl flex-col items-start gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Link href="/dashboard" className="flex items-baseline gap-2">
            <span className="font-display text-xl font-semibold">{ru.app.name}</span>
            <span className="hidden text-[10px] uppercase tracking-[0.16em] text-muted sm:inline">
              {ru.app.tagline}
            </span>
          </Link>
          <nav className="flex w-full items-center justify-between gap-2 text-xs sm:w-auto sm:justify-start sm:gap-4 sm:text-sm">
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
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
