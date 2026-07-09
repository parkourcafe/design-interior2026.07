"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runRiskPipeline } from "@/lib/brief/pipeline";
import type { AnswersMap, RiskCard, RiskStatus } from "@/lib/types";

// Все действия идут от имени залогиненного дизайнера через RLS (server client):
// доступ к чужому проекту невозможен — политика projects_owner_all.

// Сохранить свои вопросы дизайнера для проекта (RLS: только владелец).
export async function saveCustomQuestions(
  projectId: string,
  questions: string[],
): Promise<{ ok: boolean }> {
  const clean = questions.map((q) => q.trim()).filter((q) => q.length > 0).slice(0, 15);
  const supabase = await createClient();
  const { error } = await supabase
    .from("projects")
    .update({ custom_questions: clean })
    .eq("id", projectId);
  if (!error) revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: !error };
}

export async function setCardStatus(cardId: string, status: RiskStatus): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { error } = await supabase.from("risk_cards").update({ status }).eq("id", cardId);
  return { ok: !error };
}

// Пересобрать карточки (AI): перечитать ответы, прогнать пайплайн, заменить.
export async function rerunRisks(projectId: string): Promise<{ ok: boolean; llmOk: boolean }> {
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return { ok: false, llmOk: false };

  const { data: answerRows } = await supabase
    .from("answers")
    .select("question_id, value")
    .eq("project_id", projectId);

  const answers: AnswersMap = {};
  for (const row of answerRows ?? []) {
    answers[(row as { question_id: string }).question_id] = (row as { value: unknown }).value as never;
  }

  const { passport, cards, llmOk } = await runRiskPipeline(answers);

  await supabase.from("projects").update({ passport }).eq("id", projectId);
  await supabase.from("risk_cards").delete().eq("project_id", projectId);
  if (cards.length > 0) {
    await supabase.from("risk_cards").insert(
      cards.map((c: RiskCard) => ({
        project_id: projectId,
        risk_type: c.risk_type,
        evidence: c.evidence,
        impact: c.impact,
        confidence: c.confidence,
        designer_action: c.designer_action,
        proposal_implication: c.proposal_implication,
        status: "proposed",
        source: c.source,
      })),
    );
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true, llmOk };
}
