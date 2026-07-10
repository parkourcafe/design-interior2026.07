"use server";

import { revalidatePath } from "next/cache";
import { buildConceptPackFromPassport } from "@/lib/concept/build";
import { conceptPackSchema } from "@/lib/concept/schema";
import {
  derivePackageRecommendation,
  type PackageRiskCard,
} from "@/lib/proposal/package";
import { getStudio } from "@/lib/studio";
import { createClient } from "@/lib/supabase/server";
import type { AnswersMap, Passport, ProposalSection } from "@/lib/types";

type CreateConceptPackReason =
  | "unauthorized"
  | "missing_passport"
  | "invalid_content"
  | "save_failed"
  | "audit_failed";

export interface CreateConceptPackResult {
  ok: boolean;
  reason?: CreateConceptPackReason;
}

function asProposalSections(value: unknown): ProposalSection[] {
  if (!Array.isArray(value)) return [];
  return value.filter((section): section is ProposalSection => {
    if (!section || typeof section !== "object") return false;
    const candidate = section as Record<string, unknown>;
    return (
      typeof candidate.id === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.body === "string"
    );
  });
}

async function ensureCreatedEvent(
  projectId: string,
  designerId: string,
): Promise<boolean> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("events")
    .select("id")
    .eq("project_id", projectId)
    .eq("designer_id", designerId)
    .eq("type", "concept_pack_created")
    .maybeSingle();
  if (existing) return true;

  const { error } = await supabase.from("events").insert({
    designer_id: designerId,
    project_id: projectId,
    type: "concept_pack_created",
  });
  if (!error) return true;
  if (error.code !== "23505") return false;

  // Конфликт считаем идемпотентным успехом только если совпадающая строка
  // действительно видна текущей студии. Чужой pre-seeded event RLS скроет.
  const { data: duplicate } = await supabase
    .from("events")
    .select("id")
    .eq("project_id", projectId)
    .eq("designer_id", designerId)
    .eq("type", "concept_pack_created")
    .maybeSingle();
  return Boolean(duplicate);
}

export async function createConceptPack(projectId: string): Promise<CreateConceptPackResult> {
  const studio = await getStudio();
  if (!studio) return { ok: false, reason: "unauthorized" };

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id, designer_id, passport")
    .eq("id", projectId)
    .maybeSingle();

  const projectRow = project as {
    designer_id: string | null;
    passport: Passport | null;
  } | null;
  const passport = projectRow?.passport;
  const projectDesignerId = projectRow?.designer_id;
  if (!project || !passport || !projectDesignerId) {
    return { ok: false, reason: "missing_passport" };
  }

  const { data: existing } = await supabase
    .from("concept_packs")
    .select("project_id")
    .eq("project_id", projectId)
    .maybeSingle();

  if (existing) {
    const auditOk = await ensureCreatedEvent(projectId, projectDesignerId);
    return auditOk ? { ok: true } : { ok: false, reason: "audit_failed" };
  }

  const [answersResult, risksResult, proposalResult] = await Promise.all([
    supabase.from("answers").select("question_id, value").eq("project_id", projectId),
    supabase
      .from("risk_cards")
      .select("risk_type, evidence, impact, confidence, designer_action, proposal_implication, source")
      .eq("project_id", projectId)
      .eq("status", "accepted"),
    supabase
      .from("proposals")
      .select("sections")
      .eq("project_id", projectId)
      .eq("version", 1)
      .maybeSingle(),
  ]);
  if (answersResult.error || risksResult.error || proposalResult.error) {
    return { ok: false, reason: "save_failed" };
  }

  const answers: AnswersMap = {};
  for (const row of answersResult.data ?? []) {
    const answer = row as { question_id: string; value: unknown };
    answers[answer.question_id] = answer.value as never;
  }

  const acceptedRisks = (risksResult.data ?? []) as PackageRiskCard[];
  const proposalSections = asProposalSections(
    (proposalResult.data as { sections?: unknown } | null)?.sections,
  );
  const packageRecommendation = derivePackageRecommendation({
    passport,
    answers,
    riskCards: acceptedRisks,
  });
  const built = buildConceptPackFromPassport({
    passport,
    answers,
    acceptedRisks,
    package: packageRecommendation.package_key,
    proposalSections,
  });
  const parsed = conceptPackSchema.safeParse(built);
  if (!parsed.success) return { ok: false, reason: "invalid_content" };

  const { error } = await supabase.from("concept_packs").insert({
    project_id: projectId,
    status: "ready",
    content: parsed.data,
  });

  if (error) {
    // Повторный запрос мог выиграть гонку по project_id. В таком случае
    // существующий pack — корректный идемпотентный результат.
    const { data: racedPack } = await supabase
      .from("concept_packs")
      .select("project_id")
      .eq("project_id", projectId)
      .maybeSingle();
    if (!racedPack) return { ok: false, reason: "save_failed" };
  }

  const auditOk = await ensureCreatedEvent(projectId, projectDesignerId);
  if (!auditOk) return { ok: false, reason: "audit_failed" };

  revalidatePath(`/dashboard/projects/${projectId}`);
  revalidatePath(`/dashboard/projects/${projectId}/concept-pack`);
  return { ok: true };
}
