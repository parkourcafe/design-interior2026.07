"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runRiskPipeline } from "@/lib/brief/pipeline";
import type { AnswersMap, RiskCard, RiskStatus } from "@/lib/types";
import { canTransitionWorkflow } from "@/lib/platform/contracts";
import {
  normalizeRetryStepRow,
  planWorkflowRetry,
  type RetryStepRow,
} from "@/lib/platform/retry";

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

  const { data: run, error: runError } = await supabase.from("workflow_runs").select("id")
    .eq("project_id", projectId).eq("workflow_key", "client_intake_to_issued_proposal")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (runError || !run) return { ok: false, llmOk: false };
  const runId = (run as { id: string }).id;

  const { passport, cards, llmOk, llmUsage } = await runRiskPipeline(answers);

  const { data: stepId, error: commandError } = await supabase.rpc(
    "record_m1_risk_rerun",
    {
      p_project_id: projectId,
      p_workflow_run_id: runId,
      p_payload: {
        llm_outcome: llmUsage.outcome,
        fallback_used: llmUsage.outcome !== "success",
        risk_card_count: cards.length,
      },
    },
  );
  if (commandError) return { ok: false, llmOk };
  if (!stepId) return { ok: false, llmOk };

  const admin = createAdminClient();
  const { error: aiCallError } = await admin.from("ai_calls").insert({
    project_id: projectId,
    workflow_run_id: runId,
    workflow_step_run_id: stepId as string,
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
  if (aiCallError) return { ok: false, llmOk };

  const { error: passportError } = await supabase.from("projects")
    .update({ passport }).eq("id", projectId);
  if (passportError) return { ok: false, llmOk };
  const { error: deleteError } = await supabase.from("risk_cards").delete()
    .eq("project_id", projectId)
    .eq("status", "proposed");
  if (deleteError) return { ok: false, llmOk };
  if (cards.length > 0) {
    const { error: cardsError } = await supabase.from("risk_cards").insert(
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
    if (cardsError) return { ok: false, llmOk };
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
  const admin = createAdminClient();
  await admin.from("audit_events").insert({
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

export async function retryWorkflow(
  runId: string,
): Promise<{ ok: boolean; attempt?: number; error?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const { data: run } = await supabase.from("workflow_runs")
    .select("id,project_id,status,current_step").eq("id", runId).maybeSingle();
  const current = run as {
    id: string;
    project_id: string;
    status: "failed" | "retrying" | "running";
    current_step: string;
  } | null;
  if (!current) return { ok: false, error: "run_not_found" };

  const activeStatuses = ["queued", "running", "waiting_for_human", "pending_cost_confirmation"];
  const [{ data: latestRows }, { data: activeRows }] = await Promise.all([
    supabase.from("workflow_step_runs")
      .select("id,step_key,attempt,status,input_snapshot")
      .eq("workflow_run_id", runId)
      .eq("step_key", current.current_step)
      .order("attempt", { ascending: false })
      .limit(1),
    supabase.from("workflow_step_runs")
      .select("id,step_key,attempt,status,input_snapshot")
      .eq("workflow_run_id", runId)
      .eq("step_key", current.current_step)
      .in("status", activeStatuses)
      .order("attempt", { ascending: false })
      .limit(1),
  ]);
  const latest = normalizeRetryStepRow((latestRows?.[0] ?? null) as RetryStepRow | null);
  const active = normalizeRetryStepRow((activeRows?.[0] ?? null) as RetryStepRow | null);
  const plan = planWorkflowRetry({
    runStatus: current.status,
    currentStep: current.current_step,
    latestStep: latest,
    activeStep: active,
  });
  if (plan.kind === "already_running") {
    return { ok: true, attempt: plan.attempt };
  }
  if (plan.kind === "blocked" || !canTransitionWorkflow(current.status, "retrying")) {
    return { ok: false, error: plan.kind === "blocked" ? plan.reason : "invalid_transition" };
  }

  const { data: retryStep, error: prepareError } = await supabase.rpc(
    "prepare_m1_risk_retry",
    { p_workflow_run_id: runId },
  );
  if (prepareError || !retryStep) {
    // A concurrent request may have won the unique active-attempt race.
    const { data: concurrent } = await supabase.from("workflow_step_runs")
      .select("attempt")
      .eq("workflow_run_id", runId)
      .eq("step_key", plan.stepKey)
      .in("status", activeStatuses)
      .order("attempt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (concurrent) return { ok: true, attempt: Number((concurrent as { attempt: number }).attempt) };
    return { ok: false, error: prepareError?.message ?? "retry_step_prepare_failed" };
  }

  const prepared = Array.isArray(retryStep) ? retryStep[0] : retryStep;
  const stepId = (prepared as { id: string }).id;
  const preparedAttempt = Number((prepared as { attempt?: number }).attempt ?? plan.attempt);
  const admin = createAdminClient();

  try {
    const { data: answerRows, error: answersError } = await supabase
      .from("answers")
      .select("question_id,value")
      .eq("project_id", current.project_id);
    if (answersError) throw new Error(answersError.message);
    const answers: AnswersMap = {};
    for (const row of answerRows ?? []) {
      answers[(row as { question_id: string }).question_id] =
        (row as { value: unknown }).value as never;
    }

    const { passport, cards, llmOk, llmUsage } = await runRiskPipeline(answers);
    const { error: passportError } = await supabase.from("projects")
      .update({ passport }).eq("id", current.project_id);
    if (passportError) throw new Error(passportError.message);
    const { error: deleteError } = await supabase.from("risk_cards")
      .delete().eq("project_id", current.project_id).eq("status", "proposed");
    if (deleteError) throw new Error(deleteError.message);
    if (cards.length > 0) {
      const { error: cardsError } = await supabase.from("risk_cards").insert(
        cards.map((card: RiskCard) => ({
          project_id: current.project_id,
          risk_type: card.risk_type,
          evidence: card.evidence,
          impact: card.impact,
          confidence: card.confidence,
          designer_action: card.designer_action,
          proposal_implication: card.proposal_implication,
          status: "proposed",
          source: card.source,
        })),
      );
      if (cardsError) throw new Error(cardsError.message);
    }

    const { data: priorCall } = await supabase.from("ai_calls").select("id")
      .eq("workflow_run_id", runId)
      .eq("action_key", "generate_risk_register")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const { error: aiCallError } = await admin.from("ai_calls").insert({
      project_id: current.project_id,
      workflow_run_id: runId,
      workflow_step_run_id: stepId,
      action_key: "generate_risk_register",
      cost_class: "metered_ai",
      provider: llmUsage.provider,
      model: llmUsage.model,
      tokens_in: llmUsage.tokensIn,
      tokens_out: llmUsage.tokensOut,
      duration_ms: llmUsage.durationMs,
      provider_cost_estimate: llmUsage.providerCostEstimate,
      estimate_source: llmUsage.estimateSource,
      retry_of_id: (priorCall as { id?: string } | null)?.id ?? null,
      outcome: llmUsage.outcome,
    });
    if (aiCallError) throw new Error(aiCallError.message);

    const { error: completeError } = await supabase.rpc("complete_m1_risk_retry", {
      p_workflow_run_id: runId,
      p_step_run_id: stepId,
      p_output_snapshot: {
        llm_outcome: llmUsage.outcome,
        fallback_used: !llmOk,
        risk_card_count: cards.length,
      },
    });
    if (completeError) throw new Error(completeError.message);
    revalidatePath(`/dashboard/projects/${current.project_id}`);
    return { ok: true, attempt: preparedAttempt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "retry_failed";
    await supabase.rpc("fail_m1_risk_retry", {
      p_workflow_run_id: runId,
      p_step_run_id: stepId,
      p_error: { step: plan.stepKey, attempt: preparedAttempt, message },
    });
    revalidatePath(`/dashboard/projects/${current.project_id}`);
    return { ok: false, attempt: preparedAttempt, error: message };
  }
}
