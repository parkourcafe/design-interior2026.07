import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getStudio } from "@/lib/studio";
import { createClient } from "@/lib/supabase/server";
import { ru } from "@/lib/i18n/ru";
import SignOutButton from "./sign-out-button";

export const dynamic = "force-dynamic";

// Кабинет за авторизацией — вне индекса (сверх X-Robots-Tag/robots.txt).
// Покрывает все вложенные роуты (projects/*, analytics, setup, projectceo).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // ProjectCEO's request-bound AP1 runtime deliberately has no service-role
  // credential. The legacy studio shell must not make that credential a
  // prerequisite for authenticated ProjectCEO pages; production retains the
  // existing studio membership check when the server-only key is configured.
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const studio = await getStudio();
    if (!studio) redirect("/login");
  }

  // DEC-047: запрос удаления сразу закрывает кабинет — экран «Аккаунт закрыт»
  // с контактом поддержки (/account-closed; proxy.ts закрывает и переходы).
  let retentionUntil: string | null = null;
  let closed = false;
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("get_account_retention_status");
    const retention = data as { status?: string; purgeAfter?: string; closed?: boolean } | null;
    const date = retention?.purgeAfter
      ? new Date(retention.purgeAfter).toLocaleDateString("ru-RU", {
          day: "numeric", month: "long", year: "numeric",
        })
      : null;
    if (retention?.closed === true || retention?.status === "expired") closed = true;
    else if (retention?.status === "requested" && date) retentionUntil = date;
  } catch {
    retentionUntil = null;
  }

  if (closed) redirect("/account-closed");

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
      {retentionUntil ? (
        <div role="status" className="border-b border-red-200 bg-red-50">
          <p className="mx-auto max-w-5xl px-6 py-2 text-sm text-red-800">{ru.retention.banner(retentionUntil)}</p>
        </div>
      ) : null}
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
