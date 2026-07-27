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
export async function rerunRisks(
  projectId: string,
): Promise<{ ok: boolean; llmOk: boolean; error?: string }> {
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
  const configuredProvider = process.env.LLM_PROVIDER;
  const reservationProvider = configuredProvider === "gigachat" || configuredProvider === "zai"
    ? configuredProvider
    : "yandex";

  const { data: reservation, error: reservationError } = await supabase.rpc(
    "reserve_m1_risk_rerun",
    {
      p_project_id: projectId,
      p_workflow_run_id: runId,
      p_provider: reservationProvider,
      p_model: process.env.LLM_MODEL ?? "unknown",
    },
  );
  if (reservationError || !reservation) return { ok: false, llmOk: false };
  const {
    workflow_step_run_id: reservedStepId,
    ai_call_id: reservedAiCallId,
  } = reservation as {
    workflow_step_run_id: string;
    ai_call_id: string;
  };
  if (!reservedStepId || !reservedAiCallId) return { ok: false, llmOk: false };

  let pipelineResult: Awaited<ReturnType<typeof runRiskPipeline>>;
  try {
    pipelineResult = await runRiskPipeline(answers);
  } catch (error) {
    const message = error instanceof Error ? error.message : "risk_pipeline_failed";
    const { error: closeError } = await supabase.rpc("close_m1_risk_ai_reservation", {
      p_workflow_step_run_id: reservedStepId,
      p_ai_call_id: reservedAiCallId,
      p_provider_completed: false,
      p_provider: reservationProvider,
      p_model: process.env.LLM_MODEL ?? "unknown",
      p_tokens_in: 0,
      p_tokens_out: 0,
      p_duration_ms: 0,
      p_provider_cost_estimate: 0,
      p_estimate_source: "static_table",
      p_outcome: "provider_error",
      p_error: { phase: "pipeline", message },
    });
    return {
      ok: false,
      llmOk: false,
      ...(closeError ? { error: "reservation_terminalization_failed" } : {}),
    };
  }
  const { passport, cards, llmOk, llmUsage } = pipelineResult;

  const usagePayload = {
    p_workflow_step_run_id: reservedStepId,
    p_ai_call_id: reservedAiCallId,
    p_provider: llmUsage.provider,
    p_model: llmUsage.model,
    p_tokens_in: llmUsage.tokensIn,
    p_tokens_out: llmUsage.tokensOut,
    p_duration_ms: llmUsage.durationMs,
    p_provider_cost_estimate: llmUsage.providerCostEstimate,
    p_estimate_source: llmUsage.estimateSource,
    p_outcome: llmUsage.outcome,
  };
  const { error: usageError } = await supabase.rpc(
    "record_m1_risk_ai_usage",
    usagePayload,
  );
  if (usageError) {
    const { error: closeError } = await supabase.rpc(
      "close_m1_risk_ai_reservation",
      {
        ...usagePayload,
        p_provider_completed: true,
        p_error: { phase: "usage", message: usageError.message },
      },
    );
    return {
      ok: false,
      llmOk,
      error: closeError ? "usage_terminalization_failed" : "usage_persist_failed",
    };
  }

  type FinalizeRiskRerunPayload = {
    p_workflow_step_run_id: string;
    p_ai_call_id: string;
    p_passport: typeof passport;
    p_risk_cards: RiskCard[];
    p_output_snapshot: {
      llm_outcome: typeof llmUsage.outcome;
      fallback_used: boolean;
      risk_card_count: number;
    };
    p_provider: string;
    p_model: string;
    p_tokens_in: number;
    p_tokens_out: number;
    p_duration_ms: number;
    p_provider_cost_estimate: number;
    p_estimate_source: typeof llmUsage.estimateSource;
    p_outcome: typeof llmUsage.outcome;
  };
  const finalizePayload: FinalizeRiskRerunPayload = {
    p_workflow_step_run_id: reservedStepId,
    p_ai_call_id: reservedAiCallId,
    p_passport: passport,
    p_risk_cards: cards,
    p_output_snapshot: {
      llm_outcome: llmUsage.outcome,
      fallback_used: llmUsage.outcome !== "success",
      risk_card_count: cards.length,
    },
    p_provider: llmUsage.provider,
    p_model: llmUsage.model,
    p_tokens_in: llmUsage.tokensIn,
    p_tokens_out: llmUsage.tokensOut,
    p_duration_ms: llmUsage.durationMs,
    p_provider_cost_estimate: llmUsage.providerCostEstimate,
    p_estimate_source: llmUsage.estimateSource,
    p_outcome: llmUsage.outcome,
  };
  const { error: finalizeError } = await supabase.rpc(
    "finalize_m1_risk_rerun",
    finalizePayload
  );
  if (finalizeError) {
    const { error: closeError } = await supabase.rpc("close_m1_risk_ai_reservation", {
      p_workflow_step_run_id: reservedStepId,
      p_ai_call_id: reservedAiCallId,
      p_provider_completed: true,
      p_provider: llmUsage.provider,
      p_model: llmUsage.model,
      p_tokens_in: llmUsage.tokensIn,
      p_tokens_out: llmUsage.tokensOut,
      p_duration_ms: llmUsage.durationMs,
      p_provider_cost_estimate: llmUsage.providerCostEstimate,
      p_estimate_source: llmUsage.estimateSource,
      p_outcome: llmUsage.outcome,
      p_error: { phase: "finalize", message: finalizeError.message },
    });
    return {
      ok: false,
      llmOk,
      ...(closeError ? { error: "finalize_terminalization_failed" } : {}),
    };
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

  const configuredProvider = process.env.LLM_PROVIDER;
  const reservationProvider = configuredProvider === "gigachat" || configuredProvider === "zai"
    ? configuredProvider
    : "yandex";
  const { data: retryStep, error: prepareError } = await supabase.rpc(
    "reserve_m1_risk_retry",
    {
      p_workflow_run_id: runId,
      p_provider: reservationProvider,
      p_model: process.env.LLM_MODEL ?? "unknown",
    },
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
  const stepId = (prepared as { workflow_step_run_id: string }).workflow_step_run_id;
  const aiCallId = (prepared as { ai_call_id: string }).ai_call_id;
  const preparedAttempt = Number((prepared as { attempt?: number }).attempt ?? plan.attempt);
  if (!stepId || !aiCallId) {
    return { ok: false, error: "retry_reservation_invalid" };
  }

  let pipelineResult: Awaited<ReturnType<typeof runRiskPipeline>> | null = null;
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

    pipelineResult = await runRiskPipeline(answers);
    const { passport, cards, llmOk, llmUsage } = pipelineResult;
    const usagePayload = {
      p_workflow_step_run_id: stepId,
      p_ai_call_id: aiCallId,
      p_provider: llmUsage.provider,
      p_model: llmUsage.model,
      p_tokens_in: llmUsage.tokensIn,
      p_tokens_out: llmUsage.tokensOut,
      p_duration_ms: llmUsage.durationMs,
      p_provider_cost_estimate: llmUsage.providerCostEstimate,
      p_estimate_source: llmUsage.estimateSource,
      p_outcome: llmUsage.outcome,
    };
    const { error: usageError } = await supabase.rpc(
      "record_m1_risk_ai_usage",
      usagePayload,
    );
    if (usageError) throw new Error(`usage_persist_failed: ${usageError.message}`);
    const { error: completeError } = await supabase.rpc("finalize_m1_risk_rerun", {
      p_workflow_step_run_id: stepId,
      p_ai_call_id: aiCallId,
      p_passport: passport,
      p_risk_cards: cards,
      p_output_snapshot: {
        llm_outcome: llmUsage.outcome,
        fallback_used: !llmOk,
        risk_card_count: cards.length,
      },
      p_provider: llmUsage.provider,
      p_model: llmUsage.model,
      p_tokens_in: llmUsage.tokensIn,
      p_tokens_out: llmUsage.tokensOut,
      p_duration_ms: llmUsage.durationMs,
      p_provider_cost_estimate: llmUsage.providerCostEstimate,
      p_estimate_source: llmUsage.estimateSource,
      p_outcome: llmUsage.outcome,
    });
    if (completeError) throw new Error(completeError.message);
    revalidatePath(`/dashboard/projects/${current.project_id}`);
    return { ok: true, attempt: preparedAttempt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "retry_failed";
    const usage = pipelineResult?.llmUsage;
    const { error: closeError } = await supabase.rpc("close_m1_risk_ai_reservation", {
      p_workflow_step_run_id: stepId,
      p_ai_call_id: aiCallId,
      p_provider_completed: Boolean(usage),
      p_provider: usage?.provider ?? reservationProvider,
      p_model: usage?.model ?? process.env.LLM_MODEL ?? "unknown",
      p_tokens_in: usage?.tokensIn ?? 0,
      p_tokens_out: usage?.tokensOut ?? 0,
      p_duration_ms: usage?.durationMs ?? 0,
      p_provider_cost_estimate: usage?.providerCostEstimate ?? 0,
      p_estimate_source: usage?.estimateSource ?? "static_table",
      p_outcome: usage?.outcome ?? "provider_error",
      p_error: { step: plan.stepKey, attempt: preparedAttempt, message },
    });
    revalidatePath(`/dashboard/projects/${current.project_id}`);
    return {
      ok: false,
      attempt: preparedAttempt,
      error: closeError ? `terminalization_failed: ${message}` : message,
    };
  }
}
