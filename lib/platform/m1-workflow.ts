import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnswersMap, Passport } from "@/lib/types";
import type { LlmUsage } from "@/lib/llm/provider";
import { normalizeBriefFacts } from "./facts";

const WORKFLOW_KEY = "client_intake_to_issued_proposal";

export interface PersistWorkflowResult {
  ok: boolean;
  workflowRunId?: string;
  error?: string;
}

// Adapter around the existing M1 pipeline. It is deliberately fail-closed in its
// result but does not throw, so legacy intake can return a controlled error.
export async function persistBriefWorkflow(
  db: SupabaseClient,
  input: {
    projectId: string;
    initiatedBy: string | null;
    answers: AnswersMap;
    passport: Passport;
    llmUsage: LlmUsage;
  },
): Promise<PersistWorkflowResult> {
  const { data: source, error: sourceError } = await db
    .from("project_sources")
    .upsert({
      project_id: input.projectId,
      source_type: "client_brief",
      source_ref: "answers",
      title: "Клиентский бриф",
      created_by: input.initiatedBy,
    }, { onConflict: "project_id,source_type,source_ref" })
    .select("id")
    .single();
  if (sourceError || !source) return { ok: false, error: sourceError?.message ?? "source_failed" };

  const { data: existingRun } = await db
    .from("workflow_runs")
    .select("id")
    .eq("project_id", input.projectId)
    .eq("workflow_key", WORKFLOW_KEY)
    .in("status", ["queued", "running", "waiting_for_human", "pending_cost_confirmation", "retrying", "failed"])
    .maybeSingle();

  let workflowRunId = (existingRun as { id?: string } | null)?.id;
  if (!workflowRunId) {
    const { data: run, error } = await db.from("workflow_runs").insert({
      project_id: input.projectId,
      workflow_key: WORKFLOW_KEY,
      workflow_version: 1,
      status: "running",
      current_step: "extract_client_brief",
      initiated_by: input.initiatedBy,
      input_snapshot: { answer_keys: Object.keys(input.answers) },
      started_at: new Date().toISOString(),
    }).select("id").single();
    if (error || !run) return { ok: false, error: error?.message ?? "workflow_run_failed" };
    workflowRunId = (run as { id: string }).id;
  } else {
    await db.from("workflow_runs").update({
      status: "running",
      current_step: "extract_client_brief",
      error_state: null,
    }).eq("id", workflowRunId);
  }

  const { data: priorSteps } = await db.from("workflow_step_runs")
    .select("attempt").eq("workflow_run_id", workflowRunId).eq("step_key", "extract_client_brief")
    .order("attempt", { ascending: false }).limit(1);
  const attempt = Number((priorSteps?.[0] as { attempt?: number } | undefined)?.attempt ?? 0) + 1;
  const { data: step, error: stepError } = await db.from("workflow_step_runs").insert({
    workflow_run_id: workflowRunId,
    step_key: "extract_client_brief",
    attempt,
    status: "running",
    input_snapshot: { answer_keys: Object.keys(input.answers) },
    started_at: new Date().toISOString(),
  }).select("id").single();
  if (stepError || !step) return { ok: false, workflowRunId, error: stepError?.message ?? "step_failed" };
  const stepId = (step as { id: string }).id;

  for (const fact of normalizeBriefFacts(input.answers)) {
    const { data: previous } = await db.from("project_facts")
      .select("id,version").eq("project_id", input.projectId)
      .eq("evidence_locator", fact.evidence_locator)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    const prev = previous as { id: string; version: number } | null;
    const { error } = await db.from("project_facts").insert({
      ...fact,
      project_id: input.projectId,
      source_id: (source as { id: string }).id,
      version: prev ? prev.version + 1 : 1,
      supersedes_id: prev?.id ?? null,
    });
    if (error) {
      await db.from("workflow_step_runs").update({ status: "failed", error: { message: error.message }, completed_at: new Date().toISOString() }).eq("id", stepId);
      await db.from("workflow_runs").update({ status: "failed", error_state: { step: "extract_client_brief", message: error.message } }).eq("id", workflowRunId);
      return { ok: false, workflowRunId, error: error.message };
    }
  }

  const now = new Date().toISOString();
  await db.from("workflow_step_runs").insert({
    workflow_run_id: workflowRunId,
    step_key: "build_project_passport",
    attempt,
    status: "completed",
    output_snapshot: { passport_present: Boolean(input.passport) },
    started_at: now,
    completed_at: now,
  });
  const { data: riskStep, error: riskStepError } = await db.from("workflow_step_runs").insert({
    workflow_run_id: workflowRunId,
    step_key: "generate_risk_register",
    attempt,
    status: "completed",
    output_snapshot: {
      llm_outcome: input.llmUsage.outcome,
      fallback_used: input.llmUsage.outcome !== "success",
    },
    error: null,
    started_at: now,
    completed_at: now,
  }).select("id").single();
  if (riskStepError || !riskStep) return { ok: false, workflowRunId, error: riskStepError?.message ?? "risk_step_failed" };

  const { error: aiCallError } = await db.from("ai_calls").insert({
    project_id: input.projectId,
    workflow_run_id: workflowRunId,
    workflow_step_run_id: (riskStep as { id: string }).id,
    action_key: "generate_risk_register",
    cost_class: "metered_ai",
    provider: input.llmUsage.provider,
    model: input.llmUsage.model,
    tokens_in: input.llmUsage.tokensIn,
    tokens_out: input.llmUsage.tokensOut,
    duration_ms: input.llmUsage.durationMs,
    provider_cost_estimate: input.llmUsage.providerCostEstimate,
    estimate_source: input.llmUsage.estimateSource,
    outcome: input.llmUsage.outcome,
  });
  if (aiCallError) return { ok: false, workflowRunId, error: aiCallError.message };

  await db.from("workflow_step_runs").update({
    status: "completed",
    output_snapshot: { fact_count: Object.keys(input.answers).length },
    completed_at: now,
  }).eq("id", stepId);
  if (input.initiatedBy) {
    const { data: pendingApproval } = await db.from("approval_requests").select("id")
      .eq("project_id", input.projectId).eq("subject_type", "project_facts")
      .eq("approval_type", "INTERNAL_REVIEWED").eq("status", "pending").maybeSingle();
    if (!pendingApproval) {
      await db.from("approval_requests").insert({
        project_id: input.projectId,
        workflow_run_id: workflowRunId,
        subject_type: "project_facts",
        subject_id: null,
        approval_type: "INTERNAL_REVIEWED",
        required_role: "member",
        requested_by: input.initiatedBy,
        status: "pending",
      });
    }
  }
  await db.from("workflow_runs").update({
    status: "waiting_for_human",
    current_step: "human_review",
    output_snapshot: { passport_present: true },
  }).eq("id", workflowRunId);
  await db.from("audit_events").insert({
    project_id: input.projectId,
    actor_id: input.initiatedBy,
    actor_type: input.initiatedBy ? "human" : "system",
    event_type: "brief_workflow_waiting_for_review",
    entity_type: "WorkflowRun",
    entity_id: workflowRunId,
    workflow_run_id: workflowRunId,
    payload: { current_step: "human_review" },
  });

  return { ok: true, workflowRunId };
}
