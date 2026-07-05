"use server";

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
import { buildProposalSections } from "@/lib/proposal/build";
import type { RiskCardRow } from "@/lib/review";

export async function saveProposal(
  projectId: string,
  sections: ProposalSection[],
): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("proposals")
    .update({ sections })
    .eq("project_id", projectId)
    .eq("version", 1);
  if (!error) revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  return { ok: !error };
}

// Пересборка КП из актуальных данных: паспорт, цена (если настроена),
// принятые risk-карточки, proposal_defaults. Перезаписывает секции —
// ручные правки текста теряются (об этом предупреждаем в UI). После
// «Отправить» пересборка запрещена: у клиента уже живая ссылка.
export async function rebuildProposal(
  projectId: string,
): Promise<{ ok: boolean; sections?: ProposalSection[]; reason?: string }> {
  const supabase = createClient();
  const studio = await getStudio();
  if (!studio) return { ok: false };

  const { data: proposal } = await supabase
    .from("proposals")
    .select("id, status")
    .eq("project_id", projectId)
    .eq("version", 1)
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
  });

  const { error } = await supabase
    .from("proposals")
    .update({ sections })
    .eq("id", (proposal as { id: string }).id);
  if (error) return { ok: false };

  revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  return { ok: true, sections };
}

export async function sendProposal(projectId: string): Promise<{ ok: boolean }> {
  const supabase = createClient();
  const studio = await getStudio();
  if (!studio) return { ok: false };

  const { data: proposal, error } = await supabase
    .from("proposals")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("project_id", projectId)
    .eq("version", 1)
    .select("id")
    .maybeSingle();

  if (error || !proposal) return { ok: false };

  await supabase.from("projects").update({ status: "proposal_sent" }).eq("id", projectId);
  await supabase.from("events").insert({
    designer_id: studio.studioId,
    project_id: projectId,
    type: "proposal_sent",
  });

  revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  return { ok: true };
}
