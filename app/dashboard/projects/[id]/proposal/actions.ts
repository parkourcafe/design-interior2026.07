"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import type {
  AnswersMap,
  Passport,
  PricingConfig,
  ProposalDefaults,
  ProposalSection,
} from "@/lib/types";
import { calcPrice, type PriceResult } from "@/lib/pricing/calc";
import { buildProposalSections } from "@/lib/proposal/build";
import { derivePackageRecommendation } from "@/lib/proposal/package";
import { getLatestProposal } from "@/lib/proposal/latest";
import type { RiskCardRow } from "@/lib/review";

// Derive the event owner through the existing request-bound project read.
// No caller-provided identity, error body or proposal content enters telemetry.
async function recordProposalFailure(
  supabase: Awaited<ReturnType<typeof createClient>>, projectId: string,
  type: "proposal_save_failed" | "proposal_rebuild_failed" | "proposal_send_failed",
) {
  try {
    const { data: project, error } = await supabase.from("projects").select("designer_id").eq("id", projectId).maybeSingle();
    if (error || !project?.designer_id) return;
    await supabase.from("events").insert({ designer_id: project.designer_id, project_id: projectId, type });
  } catch { /* Best-effort; retain the original action result. */ }
}

type ApprovalRequest = {
  readonly subjectKind?: unknown;
  readonly subjectId?: unknown;
  readonly status?: unknown;
};

async function hasApprovedProjectPassport(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .schema("projectceo_platform_api")
    .rpc("list_approval_requests", {
      p_project_id: projectId,
      p_status: "approved",
    });
  if (error || !data || typeof data !== "object" || Array.isArray(data)) return false;
  const requests = (data as { readonly requests?: unknown }).requests;
  return Array.isArray(requests) && requests.some((value): value is ApprovalRequest => (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as ApprovalRequest).subjectKind === "project_passport"
    && (value as ApprovalRequest).subjectId === projectId
    && (value as ApprovalRequest).status === "approved"
  ));
}

export async function saveProposal(
  projectId: string,
  sections: ProposalSection[],
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  try {
    const latest = await getLatestProposal(supabase, projectId);
    if (!latest) return { ok: false };
    const { error } = await supabase
      .from("proposals")
      .update({ sections })
      .eq("id", latest.id);
    if (error) await recordProposalFailure(supabase, projectId, "proposal_save_failed");
    if (!error) revalidatePath(`/dashboard/projects/${projectId}/proposal`);
    return { ok: !error };
  } catch (error) {
    await recordProposalFailure(supabase, projectId, "proposal_save_failed");
    throw error;
  }
}

// Пересборка КП из актуальных данных: паспорт, цена (если настроена),
// принятые risk-карточки, proposal_defaults. Перезаписывает секции —
// ручные правки текста теряются (об этом предупреждаем в UI). После
// «Отправить» пересборка запрещена: у клиента уже живая ссылка.
export async function rebuildProposal(
  projectId: string,
): Promise<{ ok: boolean; sections?: ProposalSection[]; reason?: string }> {
  const supabase = await createClient();
  try {
    const studio = await getStudio();
    if (!studio) return { ok: false };

    const proposal = await getLatestProposal(supabase, projectId);
    if (!proposal) return { ok: false };
    if (proposal.status === "sent") {
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

    const { data: answerRows } = await supabase
      .from("answers")
      .select("question_id, value")
      .eq("project_id", projectId);
    const answers: AnswersMap = {};
    for (const row of answerRows ?? []) {
      answers[(row as { question_id: string }).question_id] = (row as { value: unknown }).value as never;
    }

    const packageRecommendation = derivePackageRecommendation({
      passport,
      answers,
      riskCards: acceptedCards,
    });
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

    const sections = buildProposalSections({
      passport,
      acceptedCards,
      defaults,
      price,
      packageChoice,
      packageRecommendation,
    });

    const { error } = await supabase
      .from("proposals")
      .update({ sections })
      .eq("id", proposal.id);
    if (error) {
      await recordProposalFailure(supabase, projectId, "proposal_rebuild_failed");
      return { ok: false };
    }

    revalidatePath(`/dashboard/projects/${projectId}/proposal`);
    return { ok: true, sections };
  } catch (error) {
    await recordProposalFailure(supabase, projectId, "proposal_rebuild_failed");
    throw error;
  }
}

export async function sendProposal(projectId: string): Promise<{
  ok: boolean;
  reason?: "approval_required";
}> {
  const supabase = await createClient();
  try {
    const studio = await getStudio();
    if (!studio) return { ok: false };

    const latest = await getLatestProposal(supabase, projectId);
    if (!latest) return { ok: false };
    // «Отправить клиенту» — необратимое изменение публичной поверхности КП.
    // Approval request создаётся и решается через ProjectCEO command boundary;
    // здесь проверяем только его request-bound опубликованный результат.
    if (!await hasApprovedProjectPassport(supabase, projectId)) {
      return { ok: false, reason: "approval_required" };
    }
    const { data: proposal, error } = await supabase
      .from("proposals")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", latest.id)
      .select("id")
      .maybeSingle();

    if (error || !proposal) {
      await recordProposalFailure(supabase, projectId, "proposal_send_failed");
      return { ok: false };
    }

    const projectUpdate = await supabase.from("projects").update({ status: "proposal_sent" }).eq("id", projectId);
    const sentEvent = await supabase.from("events").insert({
      designer_id: studio.studioId,
      project_id: projectId,
      type: "proposal_sent",
    });
    if (projectUpdate.error || sentEvent.error) await recordProposalFailure(supabase, projectId, "proposal_send_failed");

    revalidatePath(`/dashboard/projects/${projectId}/proposal`);
    return { ok: true };
  } catch (error) {
    await recordProposalFailure(supabase, projectId, "proposal_send_failed");
    throw error;
  }
}
