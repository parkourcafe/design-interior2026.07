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
      status: "completed",
      output_snapshot: {
        llm_outcome: llmUsage.outcome,
        fallback_used: llmUsage.outcome !== "success",
      },
      started_at: now,
      completed_at: now,
    }).select("id").single();
    if (step) {
      const admin = createAdminClient();
      await admin.from("ai_calls").insert({
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

  const { error: retryError } = await supabase.from("workflow_runs").update({
    status: "retrying",
    error_state: null,
  }).eq("id", runId).eq("status", "failed");
  if (retryError) return { ok: false, error: retryError.message };

  const startedAt = new Date().toISOString();
  const { data: retryStep, error: stepInsertError } = await supabase
    .from("workflow_step_runs")
    .insert({
      workflow_run_id: runId,
      step_key: plan.stepKey,
      attempt: plan.attempt,
      status: "running",
      input_snapshot: latest?.input_snapshot ?? {},
      started_at: startedAt,
    })
    .select("id")
    .single();
  if (stepInsertError || !retryStep) {
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
    await supabase.from("workflow_runs").update({
      status: "failed",
      error_state: { step: plan.stepKey, message: stepInsertError?.message ?? "retry_step_insert_failed" },
    }).eq("id", runId);
    return { ok: false, error: stepInsertError?.message ?? "retry_step_insert_failed" };
  }

  const stepId = (retryStep as { id: string }).id;
  const admin = createAdminClient();
  await supabase.from("workflow_runs").update({ status: "running" }).eq("id", runId);
  await admin.from("audit_events").insert({
    project_id: current.project_id,
    actor_id: user.id,
    actor_type: "human",
    event_type: "workflow_retry_started",
    entity_type: "WorkflowStepRun",
    entity_id: stepId,
    workflow_run_id: runId,
    payload: { step_key: plan.stepKey, attempt: plan.attempt, previous_attempt: latest?.attempt },
  });

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

    const completedAt = new Date().toISOString();
    const { error: stepUpdateError } = await supabase.from("workflow_step_runs").update({
      status: "completed",
      output_snapshot: {
        llm_outcome: llmUsage.outcome,
        fallback_used: !llmOk,
        risk_card_count: cards.length,
      },
      completed_at: completedAt,
      error: null,
    }).eq("id", stepId);
    if (stepUpdateError) throw new Error(stepUpdateError.message);
    const { error: runUpdateError } = await supabase.from("workflow_runs").update({
      status: "waiting_for_human",
      current_step: "human_review",
      error_state: null,
      output_snapshot: {
        resumed_from: plan.stepKey,
        retry_attempt: plan.attempt,
        risk_card_count: cards.length,
      },
    }).eq("id", runId);
    if (runUpdateError) throw new Error(runUpdateError.message);
    await admin.from("audit_events").insert({
      project_id: current.project_id,
      actor_id: user.id,
      actor_type: "human",
      event_type: "workflow_retry_completed",
      entity_type: "WorkflowStepRun",
      entity_id: stepId,
      workflow_run_id: runId,
      payload: {
        step_key: plan.stepKey,
        attempt: plan.attempt,
        llm_outcome: llmUsage.outcome,
        fallback_used: !llmOk,
      },
    });
    revalidatePath(`/dashboard/projects/${current.project_id}`);
    return { ok: true, attempt: plan.attempt };
  } catch (error) {
    const message = error instanceof Error ? error.message : "retry_failed";
    const completedAt = new Date().toISOString();
    await supabase.from("workflow_step_runs").update({
      status: "failed",
      error: { message },
      completed_at: completedAt,
    }).eq("id", stepId);
    await supabase.from("workflow_runs").update({
      status: "failed",
      error_state: { step: plan.stepKey, attempt: plan.attempt, message },
    }).eq("id", runId);
    await admin.from("audit_events").insert({
      project_id: current.project_id,
      actor_id: user.id,
      actor_type: "human",
      event_type: "workflow_retry_failed",
      entity_type: "WorkflowStepRun",
      entity_id: stepId,
      workflow_run_id: runId,
      payload: { step_key: plan.stepKey, attempt: plan.attempt, message },
    });
    revalidatePath(`/dashboard/projects/${current.project_id}`);
    return { ok: false, attempt: plan.attempt, error: message };
  }
}
