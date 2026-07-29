import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import { makeToken } from "@/lib/tokens";
import { requestBaseUrl } from "@/lib/base-url";
import { ru } from "@/lib/i18n/ru";
import type { Passport, PricingConfig, ProposalDefaults, ProposalSection } from "@/lib/types";
import { calcPrice, type PriceResult } from "@/lib/pricing/calc";
import { resolveM1ProposalComplexity } from "@/lib/platform/proposal-studio-decisions";
import { buildProposalSections } from "@/lib/proposal/build";
import { RESPONSE_TYPES } from "@/lib/proposal/respond";
import { firstMeetingQuestions, type RiskCardRow } from "@/lib/review";
import ProposalEditor from "./editor";

export const dynamic = "force-dynamic";

interface ProjectRow {
  id: string;
  client_name: string;
  status: string;
  passport: Passport | null;
}

interface ProposalWorkflowRow {
  id: string;
  status: string;
  current_step: string;
}

interface ProposalDraftResult {
  id: string;
  sections: ProposalSection[];
  status: "draft" | "sent";
  public_token: string;
}

function proposalContentDigest(sections: ProposalSection[]): string {
  const canonicalContent = sections
    .map((section) =>
      [section.id, section.title, section.body]
        .map((value) => `${Buffer.byteLength(value, "utf8")}:${value}`)
        .join(""),
    )
    .join("");

  return createHash("sha256").update(canonicalContent, "utf8").digest("hex");
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
  let proposalWorkflow: ProposalWorkflowRow | null = null;

  // Existing pre-platform M1 projects must enter the same explicit human-review
  // gate before the proposal page creates or edits any draft data.
  if (p.status !== "proposal_sent") {
    const { data: workflowRows, error: workflowReadError } = await supabase
      .from("workflow_runs")
      .select("id,status,current_step")
      .eq("project_id", p.id)
      .eq("workflow_key", "client_intake_to_issued_proposal")
      .eq("workflow_version", 1)
      .in("status", [
        "queued",
        "running",
        "waiting_for_human",
        "pending_cost_confirmation",
        "retrying",
        "failed",
      ])
      .limit(2);

    if (workflowReadError || (workflowRows?.length ?? 0) > 1) {
      throw new Error("Не удалось определить рабочий процесс предложения.");
    }

    proposalWorkflow = (
      workflowRows?.[0] as ProposalWorkflowRow | undefined
    ) ?? null;

    if (!proposalWorkflow) {
      const { data: adoptedWorkflowRunId, error: adoptionError } =
        await supabase.rpc("adopt_legacy_m1_workflow", {
          p_project_id: p.id,
        });
      if (adoptionError || !adoptedWorkflowRunId) {
        throw new Error("Не удалось подготовить проверку существующего проекта.");
      }
      redirect(`/dashboard/projects/${p.id}`);
    }

    if (
      proposalWorkflow.status === "waiting_for_human"
      && proposalWorkflow.current_step === "human_review"
    ) {
      redirect(`/dashboard/projects/${p.id}`);
    }

    const proposalWorkflowReady =
      (
        proposalWorkflow.status === "running"
        && proposalWorkflow.current_step === "generate_clarifying_questions"
      )
      || (
        proposalWorkflow.status === "waiting_for_human"
        && proposalWorkflow.current_step === "approval"
      )
      || (
        proposalWorkflow.status === "running"
        && proposalWorkflow.current_step === "issue_proposal"
      );
    if (!proposalWorkflowReady) {
      throw new Error("Рабочий процесс проекта ещё не готов к созданию предложения.");
    }
  }

  const studio = await getStudio();
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

  // Цена: считаем, если есть pricing и площадь. Иначе — режим «без цены».
  const packageChoice = passport.scope.package ?? "full";
  const proposalComplexity = await resolveM1ProposalComplexity(supabase, p.id);
  let price: PriceResult | null = null;
  if (pricing && passport.object.area_m2) {
    price = calcPrice(pricing, {
      area_m2: passport.object.area_m2,
      complexity: proposalComplexity.value,
      urgent: passport.timeline.urgency === "urgent",
      package: packageChoice,
    });
  }

  // Обеспечить наличие черновика КП (public_token + событие proposal_created).
  const { data: existing } = await supabase
    .from("proposals")
    .select("id, sections, status, public_token")
    .eq("project_id", p.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const proposedSections =
    existing
    && Array.isArray(existing.sections)
    && (existing.sections as ProposalSection[]).length > 0
      ? existing.sections as ProposalSection[]
      : buildProposalSections({
          passport,
          acceptedCards,
          defaults,
          price,
          packageChoice,
        });
  const proposedPublicToken =
    typeof existing?.public_token === "string"
      ? existing.public_token
      : makeToken();
  const { data: draftData, error: draftError } = await supabase.rpc(
    "get_or_create_m1_proposal_draft",
    {
      p_project_id: p.id,
      p_sections: proposedSections,
      p_public_token: proposedPublicToken,
      p_question_count: firstMeetingQuestions(acceptedCards).length,
      p_package_key: packageChoice,
      p_has_fee: proposedSections.some((section) => section.id === "price"),
      p_section_count: proposedSections.length,
      p_content_digest: proposalContentDigest(proposedSections),
    },
  );
  const draft = draftData as ProposalDraftResult | null;
  if (
    draftError
    || !draft?.id
    || !Array.isArray(draft.sections)
    || (draft.status !== "draft" && draft.status !== "sent")
    || typeof draft.public_token !== "string"
  ) {
    throw new Error("Не удалось создать или восстановить черновик предложения.");
  }

  const sections = draft.sections;
  const proposalId = draft.id;
  const publicToken = draft.public_token;
  const sent = draft.status === "sent";

  const { data: releaseApproval } = await supabase.from("approval_requests")
    .select("status,self_approved,proposal_revision_id")
    .eq("project_id", p.id)
    .eq("subject_type", "proposal")
    .eq("subject_id", proposalId)
    .eq("approval_type", "RELEASE_AUTHORIZED")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const approvedRevisionId = (
    releaseApproval as { proposal_revision_id?: string | null } | null
  )?.proposal_revision_id;
  const { data: approvedRevision } = approvedRevisionId
    ? await supabase.from("proposal_revisions")
      .select("sections")
      .eq("id", approvedRevisionId)
      .eq("proposal_id", proposalId)
      .maybeSingle()
    : { data: null };
  const releaseIsCurrent = Boolean(
    approvedRevision
    && JSON.stringify(approvedRevision.sections) === JSON.stringify(sections),
  );

  const publicUrl = `${await requestBaseUrl()}/p/${publicToken}`;

  // Петля обратной связи (audit S4): открывал ли клиент КП и его ответ.
  const { data: feedbackEvents } = await supabase
    .from("events")
    .select("type")
    .eq("project_id", p.id)
    .in("type", [...RESPONSE_TYPES, "proposal_viewed"]);
  const feedback = new Set((feedbackEvents ?? []).map((e) => (e as { type: string }).type));
  const clientResponse = RESPONSE_TYPES.find((t) => feedback.has(t)) ?? null;

  return (
    <div>
      <div className="mb-6">
        <Link href={`/dashboard/projects/${p.id}`} className="text-sm text-muted hover:text-ink">
          ← {ru.review.title}
        </Link>
        <h1 className="mt-1 font-display text-3xl font-semibold">{ru.proposal.draftTitle}</h1>
        <p className="mt-1 text-sm text-muted">{ru.proposal.editHint}</p>
        {!pricing && <p className="mt-1 text-sm text-amber-800">{ru.proposal.noPrice}</p>}
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
        projectId={p.id}
        initialSections={sections}
        publicUrl={publicUrl}
        alreadySent={sent}
        approved={releaseIsCurrent}
        selfApproved={
          releaseIsCurrent
          && Boolean((releaseApproval as { self_approved?: boolean } | null)?.self_approved)
        }
      />
    </div>
  );
}
