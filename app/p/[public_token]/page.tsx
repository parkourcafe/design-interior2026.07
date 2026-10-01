import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
import { isPublicLinkActive } from "@/lib/proposal/public-link";
import { ru } from "@/lib/i18n/ru";
import type { ProposalSection } from "@/lib/types";
import { RESPONSE_TYPES } from "@/lib/proposal/respond";
import PrintButton from "./print-button";
import ProposalRespond from "./respond";

export const dynamic = "force-dynamic";

// Публичное КП клиента — суммы/ПДн, вне индекса (сверх X-Robots-Tag/robots.txt).
export const metadata: Metadata = { robots: { index: false, follow: false } };

// Публичная страница КП. Доступ авторизуется public_token (service role сверяет
// на сервере). Версия для печати — через @media print, это и есть «PDF» v0.1.
export default async function PublicProposalPage({
  params,
}: {
  params: Promise<{ public_token: string }>;
}) {
  const { public_token } = await params;
  const admin = createScopedServiceClient("public-proposal");
  const { data: proposal } = await admin
    .from("proposals")
    .select("sections, status, project_id, public_expires_at")
    .eq("public_token", public_token)
    .maybeSingle();

  if (!proposal) notFound();

  // Публичная страница живёт только после «Отправить». Черновик клиент видеть
  // не должен — notFound() не раскрывает даже сам факт существования КП.
  if (!["sent", "accepted"].includes((proposal as { status?: string }).status ?? "")) notFound();

  const linkClosed = (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="card space-y-2">
        <h1 className="font-display text-2xl font-semibold">{ru.proposal.linkExpiredTitle}</h1>
        <p className="text-sm text-muted">{ru.proposal.linkExpiredBody}</p>
      </div>
    </main>
  );

  // Срок ссылки истёк или дизайнер её отозвал: содержимое КП не показываем и
  // ничего не записываем (миграция 20260928156000).
  if (!isPublicLinkActive((proposal as { public_expires_at?: string | null }).public_expires_at)) {
    return linkClosed;
  }

  const projectId = (proposal as { project_id: string }).project_id;
  const { data: project } = await admin
    .from("projects")
    .select("client_name, designer_id")
    .eq("id", projectId)
    .maybeSingle();

  const designerId = (project as { designer_id?: string | null } | null)?.designer_id ?? null;
  // DEC-047: студия запросила удаление аккаунта — ссылки клиентов гаснут сразу.
  // Не удалось проверить — ссылка закрыта, а не открыта.
  if (designerId) {
    const { data: inRetention, error: retentionError } = await admin.rpc("account_retention_active", {
      p_designer_id: designerId,
    });
    if (retentionError || inRetention === true) return linkClosed;
  }

  const sections = (proposal.sections ?? []) as ProposalSection[];
  const clientName = (project as { client_name?: string } | null)?.client_name ?? "";

  // Ответ клиента (если уже был) + событие «КП просмотрено» (один раз).
  const { data: pastEvents } = await admin
    .from("events")
    .select("type")
    .eq("project_id", projectId)
    .in("type", [...RESPONSE_TYPES, "proposal_viewed"]);
  const seen = new Set((pastEvents ?? []).map((e) => (e as { type: string }).type));
  const response = RESPONSE_TYPES.find((t) => seen.has(t)) ?? null;
  if (!seen.has("proposal_viewed")) {
    await admin.from("events").insert({
      designer_id: (project as { designer_id?: string | null } | null)?.designer_id ?? null,
      project_id: projectId,
      type: "proposal_viewed",
    });
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
