import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import { makeToken } from "@/lib/tokens";
import { requestBaseUrl } from "@/lib/base-url";
import { ru } from "@/lib/i18n/ru";
import type { AnswersMap, Passport, PricingConfig, ProposalDefaults, ProposalSection } from "@/lib/types";
import { calcPrice, type PriceResult } from "@/lib/pricing/calc";
import { buildProposalSections } from "@/lib/proposal/build";
import { getLatestProposal, nextProposalVersion } from "@/lib/proposal/latest";
import { canAdvanceProposalProjectStatus } from "@/lib/proposal/status";
import { derivePackageRecommendation } from "@/lib/proposal/package";
import { RESPONSE_TYPES } from "@/lib/proposal/respond";
import type { RiskCardRow } from "@/lib/review";
import ProposalEditor from "./editor";
import CreateRoomButton from "../room/create-button";

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

  let sections: ProposalSection[];
  let publicToken: string;
  let sent = false;

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
          .eq("status", "draft");
        if (updated.error) throw new Error("proposal_update_failed");
        await ensureProposalCreatedState("proposal_draft");
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

  const publicUrl = `${await requestBaseUrl()}/p/${publicToken}`;

  // Петля обратной связи (audit S4): открывал ли клиент КП и его ответ.
  const { data: feedbackEvents } = await supabase
    .from("events")
    .select("type")
    .eq("project_id", p.id)
    .in("type", [...RESPONSE_TYPES, "proposal_viewed"]);
  const feedback = new Set((feedbackEvents ?? []).map((e) => (e as { type: string }).type));
  const clientResponse = RESPONSE_TYPES.find((t) => feedback.has(t)) ?? null;
  const { data: existingRoom } = await supabase
    .from("project_rooms")
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
        {(clientResponse || feedback.has("proposal_viewed")) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {feedback.has("proposal_viewed") && (
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
      </div>

      <ProposalEditor
        // Смена статуса (отправка из другой вкладки) пересоздаёт редактор с
        // текстом из базы, а не с локальными несохранёнными правками.
        key={`${publicToken}:${sent ? "issued" : "draft"}`}
        projectId={p.id}
        initialSections={sections}
        publicUrl={publicUrl}
        alreadySent={sent}
      />
      {clientResponse === "proposal_accepted" && (
        <section className="card mt-6 border-accent/30">
          <h2 className="font-display text-2xl font-semibold">{ru.projectRoom.acceptedTitle}</h2>
          <p className="mb-4 text-sm text-muted">{ru.projectRoom.acceptedHint}</p>
          {existingRoom ? (
            <Link href={`/dashboard/projects/${p.id}/room`} className="btn-primary">{ru.projectRoom.open}</Link>
          ) : (
            <CreateRoomButton projectId={p.id} />
          )}
        </section>
      )}
    </div>
  );
}
