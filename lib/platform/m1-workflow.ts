import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnswersMap, Passport, RiskCard } from "@/lib/types";
import type { LlmUsage } from "@/lib/llm/provider";

export interface PersistWorkflowResult {
  ok: boolean;
  workflowRunId?: string;
  error?: string;
}

export interface ReserveInitialBriefAiCallResult extends PersistWorkflowResult {
  workflowStepRunId?: string;
  aiCallId?: string;
  replayed?: boolean;
  resultSnapshot?: {
    ok: true;
    llmOk: boolean;
    workflowRunId: string;
  };
}

export async function reserveInitialBriefAiCall(
  db: SupabaseClient,
  input: {
    projectId: string;
    answerDigest: string;
    idempotencyKey: string;
  },
): Promise<ReserveInitialBriefAiCallResult> {
  const { data, error } = await db.rpc("reserve_initial_brief_ai_call", {
    p_project_id: input.projectId,
    p_answer_digest: input.answerDigest,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) {
    console.error("[m1-workflow] reserve_initial_brief_ai_call failed", {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    });
    return {
      ok: false,
      error: error.message.includes("initial_brief_request_conflict")
        ? "initial_brief_request_conflict"
        : "initial_brief_reservation_failed",
    };
  }

  const reservation = data as {
    workflow_run_id?: string;
    workflow_step_run_id?: string;
    ai_call_id?: string;
    replayed?: boolean;
    result_snapshot?: unknown;
  } | null;
  if (
    !reservation?.workflow_run_id ||
    !reservation.workflow_step_run_id ||
    !reservation.ai_call_id
  ) {
    return { ok: false, error: "invalid_initial_brief_ai_reservation" };
  }

  const snapshot = reservation.result_snapshot as {
    ok?: unknown;
    llmOk?: unknown;
    workflowRunId?: unknown;
  } | null;
  if (
    reservation.replayed === true &&
    (
      snapshot?.ok !== true ||
      typeof snapshot.llmOk !== "boolean" ||
      snapshot.workflowRunId !== reservation.workflow_run_id
    )
  ) {
    return { ok: false, error: "invalid_initial_brief_replay" };
  }

  return {
    ok: true,
    workflowRunId: reservation.workflow_run_id,
    workflowStepRunId: reservation.workflow_step_run_id,
    aiCallId: reservation.ai_call_id,
    replayed: reservation.replayed === true,
    resultSnapshot:
      reservation.replayed === true
        ? {
            ok: true,
            llmOk: snapshot!.llmOk as boolean,
            workflowRunId: snapshot!.workflowRunId as string,
          }
        : undefined,
  };
}

export async function recordInitialBriefAiUsage(
  db: SupabaseClient,
  input: {
    projectId: string;
    workflowRunId: string;
    workflowStepRunId: string;
    aiCallId: string;
    llmUsage: LlmUsage;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.rpc("record_initial_brief_ai_usage", {
    p_project_id: input.projectId,
    p_workflow_run_id: input.workflowRunId,
    p_workflow_step_run_id: input.workflowStepRunId,
    p_ai_call_id: input.aiCallId,
    p_provider: input.llmUsage.provider,
    p_model: input.llmUsage.model,
    p_tokens_in: input.llmUsage.tokensIn,
    p_tokens_out: input.llmUsage.tokensOut,
    p_duration_ms: input.llmUsage.durationMs,
    p_provider_cost_estimate: input.llmUsage.providerCostEstimate,
    p_estimate_source: input.llmUsage.estimateSource,
    p_outcome: input.llmUsage.outcome,
  });
  if (error) return { ok: false, error: "initial_brief_usage_not_recorded" };
  return { ok: true };
}

export type InitialBriefFailureCode =
  | "provider_execution_failed"
  | "usage_persistence_failed"
  | "legacy_persistence_failed"
  | "workflow_finalization_failed";

export async function closeInitialBriefAiCall(
  db: SupabaseClient,
  input: {
    projectId: string;
    workflowRunId: string;
    workflowStepRunId: string;
    aiCallId: string;
    errorCode: InitialBriefFailureCode;
  },
): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await db.rpc("close_initial_brief_ai_call", {
    p_project_id: input.projectId,
    p_workflow_run_id: input.workflowRunId,
    p_workflow_step_run_id: input.workflowStepRunId,
    p_ai_call_id: input.aiCallId,
    p_error_code: input.errorCode,
  });
  const closure = data as { closed?: unknown } | null;
  if (error || closure?.closed !== true) {
    return { ok: false, error: "initial_brief_call_not_closed" };
  }
  return { ok: true };
}

export async function finalizeInitialBrief(
  db: SupabaseClient,
  input: {
    projectId: string;
    workflowRunId: string;
    workflowStepRunId: string;
    aiCallId: string;
    answerDigest: string;
    answers: AnswersMap;
    passport: Passport;
    riskCards: RiskCard[];
  },
): Promise<PersistWorkflowResult> {
  const { data, error } = await db.rpc("finalize_initial_brief", {
    p_project_id: input.projectId,
    p_workflow_run_id: input.workflowRunId,
    p_workflow_step_run_id: input.workflowStepRunId,
    p_ai_call_id: input.aiCallId,
    p_answer_digest: input.answerDigest,
    p_answers: input.answers,
    p_passport: input.passport,
    p_risk_cards: input.riskCards,
  });
  if (error) {
    return { ok: false, error: "initial_brief_finalization_failed" };
  }

  const result = data as { workflow_run_id?: unknown } | null;
  if (result?.workflow_run_id !== input.workflowRunId) {
    return { ok: false, error: "invalid_initial_brief_finalization" };
  }

  return { ok: true, workflowRunId: input.workflowRunId };
}
