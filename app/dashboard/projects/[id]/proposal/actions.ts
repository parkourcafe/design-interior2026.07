"use server";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import type {
  Passport,
  PricingConfig,
  ProposalDefaults,
  ProposalSection,
} from "@/lib/types";
import { calcPrice, type PriceResult } from "@/lib/pricing/calc";
import { resolveM1ProposalComplexity } from "@/lib/platform/proposal-studio-decisions";
import { buildProposalSections } from "@/lib/proposal/build";
import { firstMeetingQuestions, type RiskCardRow } from "@/lib/review";

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

async function persistProposalSections(
  projectId: string,
  sections: ProposalSection[],
): Promise<boolean> {
  const supabase = await createClient();
  const [
    { data: proposal },
    { data: project },
    { data: cardRows },
  ] = await Promise.all([
    supabase
      .from("proposals")
      .select("id,status")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("passport")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("risk_cards")
      .select("designer_action,status")
      .eq("project_id", projectId)
      .eq("status", "accepted"),
  ]);

  const proposalId = (proposal as { id?: string; status?: string } | null)?.id;
  const passport = (project as { passport?: Passport | null } | null)?.passport;
  if (
    !proposalId
    || (proposal as { status?: string }).status !== "draft"
    || !passport
    || sections.length < 1
  ) {
    return false;
  }

  const acceptedCards = (cardRows ?? []) as Array<
    Pick<RiskCardRow, "designer_action" | "status">
  >;
  const packageChoice = passport.scope.package ?? "full";
  const { data, error } = await supabase.rpc(
    "save_and_persist_m1_proposal_draft",
    {
      p_project_id: projectId,
      p_proposal_id: proposalId,
      p_sections: sections,
      question_count: firstMeetingQuestions(acceptedCards).length,
      package_key: packageChoice,
      has_fee: sections.some((section) => section.id === "price"),
      section_count: sections.length,
      content_digest: proposalContentDigest(sections),
    },
  );

  return !error && Boolean(data);
}

export async function saveProposal(
  projectId: string,
  sections: ProposalSection[],
): Promise<{ ok: boolean }> {
  const ok = await persistProposalSections(projectId, sections);
  if (ok) revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  return { ok };
}

// Пересборка КП из актуальных данных: паспорт, цена (если настроена),
// принятые risk-карточки, proposal_defaults. Перезаписывает секции —
// ручные правки текста теряются (об этом предупреждаем в UI). После
// «Отправить» пересборка запрещена: у клиента уже живая ссылка.
export async function rebuildProposal(
  projectId: string,
): Promise<{ ok: boolean; sections?: ProposalSection[]; reason?: string }> {
  const supabase = await createClient();
  const studio = await getStudio();
  if (!studio) return { ok: false };

  const { data: proposal } = await supabase
    .from("proposals")
    .select("id, status")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!proposal) return { ok: false };
  if ((proposal as { status?: string }).status === "sent") {
    return { ok: false, reason: "sent" };
  }

  const { data: project } = await supabase
    .from("projects")
    .select("passport")
    .eq("id", projectId)
    .maybeSingle();
  const passport = (project as { passport: Passport | null } | null)?.passport;
  if (!passport) return { ok: false };

  const pricing = (studio.designer.pricing ?? null) as PricingConfig | null;
  const defaults = (studio.designer.proposal_defaults ?? {
    exclusions: [],
    revision_limit: 2,
    stage_completion: "",
  }) as ProposalDefaults;

  const { data: cardRows } = await supabase
    .from("risk_cards")
    .select("id, risk_type, evidence, impact, confidence, designer_action, proposal_implication, status, source")
    .eq("project_id", projectId)
    .eq("status", "accepted");
  const acceptedCards = (cardRows ?? []) as RiskCardRow[];

  const packageChoice = passport.scope.package ?? "full";
  const proposalComplexity = await resolveM1ProposalComplexity(
    supabase,
    projectId,
  );
  let price: PriceResult | null = null;
  if (pricing && passport.object.area_m2) {
    price = calcPrice(pricing, {
      area_m2: passport.object.area_m2,
      complexity: proposalComplexity.value,
      urgent: passport.timeline.urgency === "urgent",
      package: packageChoice,
    });
  }

  const sections = buildProposalSections({
    passport,
    acceptedCards,
    defaults,
    price,
    packageChoice,
  });

  const saved = await persistProposalSections(projectId, sections);
  if (!saved) return { ok: false };

  revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  return { ok: true, sections };
}

export async function sendProposal(
  projectId: string,
): Promise<{ ok: boolean; reason?: "approval_stale" }> {
  const supabase = await createClient();
  const studio = await getStudio();
  if (!studio) return { ok: false };

  const { data: proposal } = await supabase
    .from("proposals")
    .select("id, sections, status")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!proposal || (proposal as { status: string }).status !== "draft") {
    return { ok: false };
  }

  const { data: approval } = await supabase
    .from("approval_requests")
    .select("id,proposal_revision_id")
    .eq("project_id", projectId)
    .eq("subject_type", "proposal")
    .eq("subject_id", (proposal as { id: string }).id)
    .eq("approval_type", "RELEASE_AUTHORIZED")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!approval) return { ok: false };

  const revisionId = (approval as { proposal_revision_id?: string | null }).proposal_revision_id;
  if (!revisionId) return { ok: false };
  const { data: revision } = await supabase
    .from("proposal_revisions")
    .select("sections")
    .eq("id", revisionId)
    .maybeSingle();
  if (!revision) return { ok: false };
  if (JSON.stringify(revision.sections) !== JSON.stringify(proposal.sections)) {
    return { ok: false, reason: "approval_stale" };
  }

  const { error } = await supabase.rpc("issue_proposal_revision", {
    p_proposal_revision_id: revisionId,
    p_approval_request_id: (approval as { id: string }).id,
  });
  if (error) return { ok: false };

  revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  return { ok: true };
}

export async function approveProposal(
  projectId: string,
): Promise<{ ok: boolean; selfApproved?: boolean }> {
  const supabase = await createClient();
  const studio = await getStudio();
  if (!studio) return { ok: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { data: run } = await supabase.from("workflow_runs").select("id")
    .eq("project_id", projectId)
    .eq("workflow_key", "client_intake_to_issued_proposal")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const { data: proposal } = await supabase.from("proposals")
    .select("id,status")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const runId = (run as { id?: string } | null)?.id;
  if (!proposal || !runId || (proposal as { status: string }).status !== "draft") {
    return { ok: false };
  }
  const { data: approvalId, error } = await supabase.rpc("authorize_proposal_revision", {
    p_proposal_id: (proposal as { id: string }).id,
    p_workflow_run_id: runId,
  });
  if (error || !approvalId) return { ok: false };

  const { data: approval } = await supabase.from("approval_requests")
    .select("self_approved")
    .eq("id", approvalId as string)
    .maybeSingle();
  const selfApproved = Boolean(
    (approval as { self_approved?: boolean } | null)?.self_approved,
  );
  revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  return { ok: true, selfApproved };
}
