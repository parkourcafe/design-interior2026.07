import { describe, expect, it } from "vitest";
import { normalizeRetryStepRow, planWorkflowRetry } from "./retry";

describe("workflow retry planning", () => {
  it("creates exactly the next attempt for a failed retryable step", () => {
    expect(planWorkflowRetry({
      runStatus: "failed",
      currentStep: "generate_risk_register",
      latestStep: { stepKey: "generate_risk_register", attempt: 2, status: "failed" },
      activeStep: null,
    })).toEqual({
      kind: "start",
      stepKey: "generate_risk_register",
      attempt: 3,
    });
  });

  it("normalizes PostgREST snake_case rows before planning", () => {
    expect(normalizeRetryStepRow({
      id: "step-1",
      step_key: "generate_risk_register",
      attempt: 1,
      status: "failed",
      input_snapshot: {},
    })).toMatchObject({
      id: "step-1",
      stepKey: "generate_risk_register",
      attempt: 1,
      status: "failed",
    });
  });

  it("is idempotent while the retry attempt is already active", () => {
    expect(planWorkflowRetry({
      runStatus: "retrying",
      currentStep: "generate_risk_register",
      latestStep: { stepKey: "generate_risk_register", attempt: 2, status: "failed" },
      activeStep: { stepKey: "generate_risk_register", attempt: 3, status: "running" },
    })).toEqual({
      kind: "already_running",
      stepKey: "generate_risk_register",
      attempt: 3,
    });
  });

  it("does not replay completed or unsupported steps", () => {
    expect(planWorkflowRetry({
      runStatus: "failed",
      currentStep: "build_project_passport",
      latestStep: { stepKey: "build_project_passport", attempt: 1, status: "failed" },
      activeStep: null,
    })).toEqual({ kind: "blocked", reason: "step_not_retryable" });
    expect(planWorkflowRetry({
      runStatus: "failed",
      currentStep: "generate_risk_register",
      latestStep: { stepKey: "generate_risk_register", attempt: 1, status: "completed" },
      activeStep: null,
    })).toEqual({ kind: "blocked", reason: "no_failed_attempt" });
  });
});
