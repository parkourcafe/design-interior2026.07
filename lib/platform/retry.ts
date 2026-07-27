import type { WorkflowStatus } from "./contracts";

export const RETRYABLE_M1_STEPS = ["generate_risk_register"] as const;
export type RetryableM1Step = (typeof RETRYABLE_M1_STEPS)[number];

export interface RetryStepState {
  stepKey: string;
  attempt: number;
  status: string;
}

export interface RetryStepRow {
  id: string;
  step_key: string;
  attempt: number;
  status: string;
  input_snapshot: unknown;
}

export function normalizeRetryStepRow(row: RetryStepRow | null): (RetryStepState & RetryStepRow) | null {
  return row ? { ...row, stepKey: row.step_key } : null;
}

export type RetryPlan =
  | { kind: "start"; stepKey: RetryableM1Step; attempt: number }
  | { kind: "already_running"; stepKey: RetryableM1Step; attempt: number }
  | { kind: "blocked"; reason: "run_not_failed" | "step_not_retryable" | "no_failed_attempt" };

export function planWorkflowRetry(input: {
  runStatus: WorkflowStatus;
  currentStep: string;
  latestStep: RetryStepState | null;
  activeStep: RetryStepState | null;
}): RetryPlan {
  if (!RETRYABLE_M1_STEPS.includes(input.currentStep as RetryableM1Step)) {
    return { kind: "blocked", reason: "step_not_retryable" };
  }
  const stepKey = input.currentStep as RetryableM1Step;

  if (
    input.activeStep
    && input.activeStep.stepKey === stepKey
    && ["queued", "running", "waiting_for_human", "pending_cost_confirmation"].includes(input.activeStep.status)
  ) {
    return { kind: "already_running", stepKey, attempt: input.activeStep.attempt };
  }

  if (input.runStatus !== "failed") {
    return { kind: "blocked", reason: "run_not_failed" };
  }
  if (
    !input.latestStep
    || input.latestStep.stepKey !== stepKey
    || input.latestStep.status !== "failed"
  ) {
    return { kind: "blocked", reason: "no_failed_attempt" };
  }

  return { kind: "start", stepKey, attempt: input.latestStep.attempt + 1 };
}
