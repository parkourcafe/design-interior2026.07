import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ru } from "@/lib/i18n/ru";

// Токен-страница — вне индекса (сверх X-Robots-Tag/robots.txt).
export const metadata: Metadata = { robots: { index: false, follow: false } };
import type { Passport } from "@/lib/types";
import PassportView from "@/components/passport-view";
import PrintButton from "@/components/print-button";

export const dynamic = "force-dynamic";

// Публичная read-only ссылка-бриф. Клиент рассылает её выбранным дизайнерам.
// Доступ по intake-токену через service role. Показываем только паспорт
// (заявку клиента), без карточек рисков — это инструмент дизайнера.
export default async function BriefSharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const { data: project } = await admin
    .from("projects")
    .select("client_name, passport")
    .eq("intake_token", token)
    .maybeSingle();

  if (!project) notFound();

  const passport = (project as { passport: Passport | null }).passport;
  const clientName = (project as { client_name?: string }).client_name?.trim();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted">{ru.briefShare.title}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">
            {clientName || ru.briefShare.subtitle}
          </h1>
        </div>
        <PrintButton label={ru.briefShare.print} />
      </header>

      {passport ? (
        <PassportView passport={passport} />
      ) : (
        <p className="text-muted">{ru.briefShare.notReady}</p>
      )}
    </main>
  );
}
