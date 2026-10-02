import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import { makeToken } from "@/lib/tokens";
import { requestBaseUrl } from "@/lib/base-url";
import { ru } from "@/lib/i18n/ru";
import type { AnswersMap, Passport, PricingConfig, ProposalDefaults, ProposalSection } from "@/lib/types";
import { calcPrice, type PriceResult } from "@/lib/pricing/calc";
import { buildProposalSections, proposalHintsFromRisks } from "@/lib/proposal/build";
import { getLatestProposal, nextProposalVersion } from "@/lib/proposal/latest";
import { canAdvanceProposalProjectStatus } from "@/lib/proposal/status";
import { derivePackageRecommendation } from "@/lib/proposal/package";
import { ACTION_EVENT, readProposalResponse } from "@/lib/proposal/respond";
import type { RiskCardRow } from "@/lib/review";
import ProposalEditor from "./editor";
import CreateRevisionButton from "./revision-button";
import PassportApproval from "./passport-approval";
import { readPassportApproval } from "@/lib/proposal/passport-approval";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  client_name: string;
  status: string;
  passport: Passport | null;
}

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id, client_name, status, passport")
    .eq("id", id)
    .maybeSingle();
  if (!project) notFound();
  const p = project as ProjectRow;
  if (!p.passport) notFound();
  const passport = p.passport;

  const studio = await getStudio();
  async function recordCreationFailure() {
    if (!studio) return;
    try {
      await supabase.from("events").insert({ designer_id: studio.studioId, project_id: p.id, type: "proposal_create_failed" });
    } catch { /* Best-effort; keep the original rendering behavior. */ }
  }
  async function ensureProposalCreatedState(desiredProjectStatus: "proposal_draft" | "proposal_sent" | "proposal_accepted") {
    if (canAdvanceProposalProjectStatus(p.status, desiredProjectStatus)) {
      const updated = await supabase.from("projects").update({ status: desiredProjectStatus })
        .eq("id", p.id).eq("status", p.status);
      if (updated.error) throw new Error("proposal_project_reconciliation_failed");
    }
    const { data: createdEvents, error: readError } = await supabase.from("events")
      .select("id").eq("project_id", p.id).eq("type", "proposal_created").limit(1);
    if (readError) throw new Error("proposal_event_reconciliation_read_failed");
    if (!createdEvents?.length) {
      const event = await supabase.from("events").insert({
        designer_id: studio!.studioId,
        project_id: p.id,
        type: "proposal_created",
      });
      if (event.error) throw new Error("proposal_event_reconciliation_failed");
    }
  }

  const pricing = (studio?.designer.pricing ?? null) as PricingConfig | null;
  const defaults = (studio?.designer.proposal_defaults ?? {
    exclusions: [],
    revision_limit: 2,
    stage_completion: "",
  }) as ProposalDefaults;

  const { data: cardRows } = await supabase
    .from("risk_cards")
    .select("id, risk_type, evidence, impact, confidence, designer_action, proposal_implication, status, source")
    .eq("project_id", p.id)
    .eq("status", "accepted");
  const acceptedCards = (cardRows ?? []) as RiskCardRow[];

  const { data: answerRows } = await supabase
    .from("answers")
    .select("question_id, value")
    .eq("project_id", p.id);
  const answers: AnswersMap = {};
  for (const row of answerRows ?? []) {
    answers[(row as { question_id: string }).question_id] = (row as { value: unknown }).value as never;
  }

  // Цена: считаем, если есть pricing и площадь. Иначе — режим «без цены».
  const packageRecommendation = derivePackageRecommendation({ passport, answers, riskCards: acceptedCards });
  const packageChoice = packageRecommendation.package_key;
  let price: PriceResult | null = null;
  if (pricing && passport.object.area_m2) {
    price = calcPrice(pricing, {
      area_m2: passport.object.area_m2,
      complexity: "mid",
      urgent: passport.timeline.urgency === "urgent",
      package: packageChoice,
    });
  }

  // Обеспечить наличие черновика КП (public_token + событие proposal_created).
  const existing = await getLatestProposal(supabase, p.id);

  // DEC-044 (a): аккаунт в сроке удаления — только чтение. Страница не
  // создаёт и не пересобирает черновик; выданное КП открывается по ссылке.
  const { data: retention } = await supabase.rpc("get_account_retention_status");
  const retentionStatus = (retention as { status?: string } | null)?.status;
  if (retentionStatus === "requested" || retentionStatus === "expired") {
    const issuedToken = existing && (existing.status === "sent" || existing.status === "accepted")
      ? existing.public_token as string
      : null;
    return (
      <div className="card space-y-2">
        <p className="text-sm text-muted">{ru.retention.readOnlyProposal}</p>
        {issuedToken ? (
          <a className="text-sm underline" href={`/p/${issuedToken}`}>{ru.retention.openIssuedProposal}</a>
        ) : null}
      </div>
    );
  }

  let sections: ProposalSection[];
  let publicToken: string;
  let sent = false;
  let issuedMeanwhile = false;

  // Выданное КП (sent/accepted) не пересобирается даже с пустыми секциями:
  // его содержимое неизменяемо и в базе (proposals_lifecycle_guard).
  const issued = existing?.status === "sent" || existing?.status === "accepted";
  if (existing && (issued || (Array.isArray(existing.sections) && (existing.sections as ProposalSection[]).length > 0))) {
    sections = Array.isArray(existing.sections) ? existing.sections as ProposalSection[] : [];
    publicToken = existing.public_token as string;
    sent = issued;
    try {
      await ensureProposalCreatedState(existing.status === "accepted"
        ? "proposal_accepted"
        : existing.status === "sent" ? "proposal_sent" : "proposal_draft");
    } catch (error) {
      await recordCreationFailure();
      throw error;
    }
  } else {
    try {
      sections = buildProposalSections({
        passport,
        acceptedCards,
        defaults,
        price,
        packageChoice,
        packageRecommendation,
      });
      if (existing) {
        publicToken = existing.public_token as string;
        const updated = await supabase.from("proposals").update({ sections })
          .eq("id", existing.id)
          .eq("status", "draft")
          .select("id")
          .maybeSingle();
        if (updated.error) throw new Error("proposal_update_failed");
        // КП успели отправить между чтением и записью (другая вкладка):
        // показываем выданное состояние, а не пересобранный «черновик».
        if (!updated.data) issuedMeanwhile = true;
        else await ensureProposalCreatedState("proposal_draft");
      } else {
        publicToken = makeToken();
        const created = await supabase.from("proposals").insert({
          project_id: p.id,
          version: await nextProposalVersion(supabase, p.id),
          sections,
          status: "draft",
          public_token: publicToken,
        });
        if (created.error) throw new Error("proposal_create_failed");
        await ensureProposalCreatedState("proposal_draft");
      }
    } catch (error) {
      await recordCreationFailure();
      throw error;
    }
  }
  // Перечитываем страницу вне try: redirect() бросает служебное исключение,
  // которое не должно засчитываться как сбой создания КП.
  if (issuedMeanwhile) redirect(`/dashboard/projects/${p.id}/proposal`);

  const publicUrl = `${await requestBaseUrl()}/p/${publicToken}`;
  const riskHints = proposalHintsFromRisks(acceptedCards);
  // Аудит 28.09, шаг 6: до отправки — блок подтверждения паспорта проекта.
  const passportApproval = sent ? null : await readPassportApproval(supabase, p.id);

  // Петля обратной связи (audit S4): открывал ли клиент КП и его ответ на
  // последнюю выданную версию (20261001100000: ответ привязан к версии).
  const { data: viewedEvents } = await supabase
    .from("events")
    .select("type")
    .eq("project_id", p.id)
    .eq("type", "proposal_viewed")
    .limit(1);
  const clientViewed = Boolean(viewedEvents?.length);
  const { data: issuedRow } = await supabase
    .from("proposals")
    .select("id, version, status, sent_at")
    .eq("project_id", p.id)
    .in("status", ["sent", "accepted"])
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const lastIssued = issuedRow as { id: string; version: number; status: string; sent_at: string | null } | null;
  const issuedResponse = lastIssued
    ? await readProposalResponse(supabase, { ...lastIssued, project_id: p.id })
    : { eventType: null, comment: null };
  const clientResponse = issuedResponse.eventType;
  const canRevise = sent && existing?.status === "sent"
    && (clientResponse === ACTION_EVENT.changes || clientResponse === ACTION_EVENT.discuss);
  const draftAfterIssued = !sent && existing && lastIssued && lastIssued.version < existing.version
    ? { draft: existing.version, issued: lastIssued.version }
    : null;
  const { data: existingRoom } = await supabase
    .from("project_rooms")
    .select("id")
    .eq("project_id", p.id)
    .maybeSingle();
  const { data: kitRow } = existingRoom
    ? await supabase
      .from("project_handover_kits")
      .select("id, created_at")
      .eq("room_id", (existingRoom as { id: string }).id)
      .maybeSingle()
    : { data: null };
  const existingKit = kitRow as { id: string; created_at: string } | null;
  const { data: handoverDraft } = await supabase
    .from("project_handover_drafts")
    .select("id")
    .eq("project_id", p.id)
    .maybeSingle();

  return (
    <div>
      <div className="mb-6">
        <Link href={`/dashboard/projects/${p.id}`} className="text-sm text-muted hover:text-ink">
          ← {ru.review.title}
        </Link>
        <h1 className="mt-1 font-display text-3xl font-semibold">{ru.proposal.draftTitle}</h1>
        <p className="mt-1 text-sm text-muted">{ru.proposal.editHint}</p>
        {!pricing && <p className="mt-1 text-sm text-amber-800">{ru.proposal.noPrice}</p>}
        <div className="mt-3 rounded-md border border-line bg-white p-3 text-sm">
          <div>
            <span className="text-muted">{ru.proposal.packageRecommendation}: </span>
            <span className="font-medium">{packageRecommendation.package_label}</span>
            <span className="text-muted"> {ru.proposal.packageAuto}</span>
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
            {packageRecommendation.pricing_explanation_points.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted">{ru.proposal.packageRecommendationHint}</p>
        </div>
        {existing ? (
          <p className="mt-2 text-xs text-muted">{ru.proposal.versionLabel(existing.version)}</p>
        ) : null}
        {draftAfterIssued ? (
          <p className="mt-2 text-sm text-amber-800">
            {ru.proposal.revisionDraftFor(draftAfterIssued.draft, draftAfterIssued.issued)}
          </p>
        ) : null}
        {(clientResponse || clientViewed) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {clientViewed && (
              <span className="rounded-full border border-line bg-white px-3 py-1 text-xs text-muted">
                {ru.proposal.clientViewed}
              </span>
            )}
            {clientResponse && (
              <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
                {ru.proposal.clientResponse}: {ru.proposal.clientResponseValue[clientResponse]}
              </span>
            )}
          </div>
        )}
        {issuedResponse.comment ? (
          <div className="mt-3 rounded-md border border-line bg-white p-3 text-sm">
            <p className="text-xs uppercase tracking-wide text-muted">
              {ru.proposal.clientComment}
              {lastIssued ? ` · ${ru.proposal.versionLabel(lastIssued.version)}` : ""}
            </p>
            <p className="mt-1 whitespace-pre-line">{issuedResponse.comment}</p>
          </div>
        ) : null}
        {canRevise && existing ? (
          <section className="card mt-4 border-accent/30">
            <h2 className="font-display text-xl font-semibold">{ru.proposal.revisionTitle}</h2>
            <p className="mb-3 mt-1 text-sm text-muted">{ru.proposal.revisionHint}</p>
            <CreateRevisionButton projectId={p.id} nextVersion={existing.version + 1} />
          </section>
        ) : null}
      </div>

      {!sent && riskHints.length > 0 ? (
        <section className="card mb-4 border-amber-300/60 bg-amber-50/40">
          <h2 className="font-medium">{ru.proposal.riskHintsTitle}</h2>
          <p className="mt-1 text-xs text-muted">{ru.proposal.riskHintsLead}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {riskHints.map((hint) => <li key={hint}>{hint}</li>)}
          </ul>
        </section>
      ) : null}
      {passportApproval ? <PassportApproval projectId={p.id} initial={passportApproval} /> : null}
      <ProposalEditor
        // Смена статуса (отправка из другой вкладки) пересоздаёт редактор с
        // текстом из базы, а не с локальными несохранёнными правками.
        key={`${publicToken}:${sent ? "issued" : "draft"}`}
        projectId={p.id}
        initialSections={sections}
        publicUrl={publicUrl}
        alreadySent={sent}
        linkExpiresAt={existing?.public_expires_at ?? null}
      />
      {clientResponse === "proposal_accepted" && (
        <section className="card mt-6 border-accent/30">
          <h2 className="font-display text-2xl font-semibold">{ru.projectRoom.acceptedTitle}</h2>
          <p className="mb-4 text-sm text-muted">{ru.projectRoom.acceptedHint}</p>
          {existingKit ? (
            <div className="space-y-2">
              <p className="text-sm">{ru.handover.kitCreated(new Date(existingKit.created_at).toLocaleString("ru-RU"))}</p>
              <Link href={`/dashboard/projects/${p.id}/room`} className="btn-primary">{ru.projectRoom.open}</Link>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-muted">{ru.handover.hint}</p>
              {existingRoom ? (
                <Link href={`/dashboard/projects/${p.id}/room`} className="btn-ghost mb-3 inline-block">{ru.projectRoom.open}</Link>
              ) : null}
              <Link href={`/dashboard/projects/${p.id}/handover`} className="btn-primary inline-block">
                {handoverDraft ? ru.handover.continuePrepare : ru.handover.prepare}
              </Link>
            </>
          )}
        </section>
      )}
    </div>
  );
}
