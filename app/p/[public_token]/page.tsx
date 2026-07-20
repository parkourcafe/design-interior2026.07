import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ru } from "@/lib/i18n/ru";

// Публичное КП клиента — суммы/ПДн, вне индекса (сверх X-Robots-Tag/robots.txt).
export const metadata: Metadata = { robots: { index: false, follow: false } };
import type { ProposalSection } from "@/lib/types";
import PrintButton from "./print-button";
import ProposalRespond from "./respond";

export const dynamic = "force-dynamic";

// Публичная страница КП. Доступ авторизуется public_token (service role сверяет
// на сервере). Версия для печати — через @media print, это и есть «PDF» v0.1.
export default async function PublicProposalPage({
  params,
}: {
  params: Promise<{ public_token: string }>;
}) {
  const { public_token } = await params;
  const admin = createAdminClient();
  const { data: proposal } = await admin
    .from("proposals")
    .select("sections, status, project_id, client_response, first_viewed_at")
    .eq("public_token", public_token)
    .maybeSingle();

  if (!proposal) notFound();

  // Публичная страница живёт только после «Отправить». Черновик клиент видеть
  // не должен — notFound() не раскрывает даже сам факт существования КП.
  if ((proposal as { status?: string }).status !== "sent") notFound();

  const projectId = (proposal as { project_id: string }).project_id;
  const { data: project } = await admin
    .from("projects")
    .select("client_name")
    .eq("id", projectId)
    .maybeSingle();

  const sections = (proposal.sections ?? []) as ProposalSection[];
  const clientName = (project as { client_name?: string } | null)?.client_name ?? "";

  // Ответ клиента (если уже был) — читаем сразу со строки proposals (S3).
  const response = (proposal as { client_response?: string | null }).client_response ?? null;

  // Первый просмотр — фиксируем один раз (условие в WHERE, без гонки).
  if (!(proposal as { first_viewed_at?: string | null }).first_viewed_at) {
    await admin
      .from("proposals")
      .update({ first_viewed_at: new Date().toISOString() })
      .eq("public_token", public_token)
      .is("first_viewed_at", null);
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted">{ru.proposal.title}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold">{clientName}</h1>
        </div>
        <PrintButton />
      </header>

      <article className="space-y-5">
        {sections.map((s) => (
          <section key={s.id} className="card">
            <h2 className="mb-2 font-display text-2xl font-semibold">{s.title}</h2>
            <p className="whitespace-pre-line text-[15px] leading-[1.7] text-ink/90">{s.body}</p>
          </section>
        ))}
      </article>

      {/* Решение клиента: принять / обсудить / запросить правки (audit S3). */}
      <ProposalRespond token={public_token} initialResponse={response} />
    </main>
  );
}
