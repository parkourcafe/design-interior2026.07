import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ru } from "@/lib/i18n/ru";
import type { ProposalSection } from "@/lib/types";
import PrintButton from "./print-button";

export const dynamic = "force-dynamic";

// Публичная страница КП. Доступ авторизуется public_token (service role сверяет
// на сервере). Версия для печати — через @media print, это и есть «PDF» v0.1.
export default async function PublicProposalPage({
  params,
}: {
  params: { public_token: string };
}) {
  const admin = createAdminClient();
  const { data: proposal } = await admin
    .from("proposals")
    .select("sections, status, project_id")
    .eq("public_token", params.public_token)
    .maybeSingle();

  if (!proposal) notFound();

  const { data: project } = await admin
    .from("projects")
    .select("client_name")
    .eq("id", (proposal as { project_id: string }).project_id)
    .maybeSingle();

  const sections = (proposal.sections ?? []) as ProposalSection[];
  const clientName = (project as { client_name?: string } | null)?.client_name ?? "";

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-widest text-muted">{ru.proposal.title}</p>
          <h1 className="mt-1 text-2xl font-semibold">{clientName}</h1>
        </div>
        <PrintButton />
      </header>

      <article className="space-y-6">
        {sections.map((s) => (
          <section key={s.id} className="card">
            <h2 className="mb-2 text-lg font-semibold">{s.title}</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed">{s.body}</p>
          </section>
        ))}
      </article>
    </main>
  );
}
