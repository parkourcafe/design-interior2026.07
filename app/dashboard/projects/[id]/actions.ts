"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { runRiskPipeline } from "@/lib/brief/pipeline";
import type { AnswersMap, RiskCard, RiskStatus } from "@/lib/types";
import { canTransitionWorkflow } from "@/lib/platform/contracts";

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

  const { passport, cards, llmOk, llmUsage } = await runRiskPipeline(answers);

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

  const { data: run } = await supabase.from("workflow_runs").select("id")
    .eq("project_id", projectId).eq("workflow_key", "client_intake_to_issued_proposal")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (run) {
    const runId = (run as { id: string }).id;
    const { data: prior } = await supabase.from("workflow_step_runs").select("attempt")
      .eq("workflow_run_id", runId).eq("step_key", "generate_risk_register")
      .order("attempt", { ascending: false }).limit(1);
    const attempt = Number((prior?.[0] as { attempt?: number } | undefined)?.attempt ?? 0) + 1;
    const now = new Date().toISOString();
    const { data: step } = await supabase.from("workflow_step_runs").insert({
      workflow_run_id: runId,
      step_key: "generate_risk_register",
      attempt,
      status: llmUsage.outcome === "success" ? "completed" : "failed",
      output_snapshot: { llm_outcome: llmUsage.outcome },
      started_at: now,
      completed_at: now,
    }).select("id").single();
    if (step) {
      await supabase.from("ai_calls").insert({
        project_id: projectId,
        workflow_run_id: runId,
        workflow_step_run_id: (step as { id: string }).id,
        action_key: "generate_risk_register",
        cost_class: "metered_ai",
        provider: llmUsage.provider,
        model: llmUsage.model,
        tokens_in: llmUsage.tokensIn,
        tokens_out: llmUsage.tokensOut,
        duration_ms: llmUsage.durationMs,
        provider_cost_estimate: llmUsage.providerCostEstimate,
        estimate_source: llmUsage.estimateSource,
        outcome: llmUsage.outcome,
      });
    }
  }

  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true, llmOk };
}

export async function reviewProjectFact(
  factId: string,
  status: "human_confirmed" | "rejected",
): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { data: fact } = await supabase.from("project_facts")
    .select("id,project_id,fact_type,value,source_id,evidence_locator,confidence,version")
    .eq("id", factId).maybeSingle();
  if (!fact) return { ok: false };
  const current = fact as {
    id: string; project_id: string; fact_type: string; value: unknown; source_id: string;
    evidence_locator: string; confidence: number | null; version: number;
  };
  const { error } = await supabase.from("project_facts").insert({
    project_id: current.project_id,
    fact_type: current.fact_type,
    value: current.value,
    source_id: current.source_id,
    evidence_locator: current.evidence_locator,
    status,
    confidence: current.confidence,
    created_by_type: "human",
    created_by_id: user.id,
    version: current.version + 1,
    supersedes_id: current.id,
  });
  if (error) return { ok: false };
  await supabase.from("audit_events").insert({
    project_id: current.project_id,
    actor_id: user.id,
    actor_type: "human",
    event_type: status === "human_confirmed" ? "fact_confirmed" : "fact_rejected",
    entity_type: "ProjectFact",
    entity_id: current.id,
    payload: { evidence_locator: current.evidence_locator },
  });
  revalidatePath(`/dashboard/projects/${current.project_id}`);
  return { ok: true };
}

export async function retryWorkflow(runId: string): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: run } = await supabase.from("workflow_runs")
    .select("id,project_id,status").eq("id", runId).maybeSingle();
  const current = run as { id: string; project_id: string; status: "failed" } | null;
  if (!current || !canTransitionWorkflow(current.status, "retrying")) return { ok: false };
  const { error } = await supabase.from("workflow_runs").update({
    status: "retrying",
    error_state: null,
  }).eq("id", runId);
  if (!error) revalidatePath(`/dashboard/projects/${current.project_id}`);
  return { ok: !error };
}
