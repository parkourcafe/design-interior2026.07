import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  runRiskPipeline: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/brief/pipeline", () => ({
  runRiskPipeline: mocks.runRiskPipeline,
}));
vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

import { rerunRisks } from "@/app/dashboard/projects/[id]/actions";

const projectId = "11111111-1111-4111-8111-111111111111";
const workflowRunId = "22222222-2222-4222-8222-222222222222";
const stepRunId = "33333333-3333-4333-8333-333333333333";
const aiCallId = "44444444-4444-4444-8444-444444444444";

function createSupabase({
  reservationError = null,
  reservation = {
    workflow_step_run_id: stepRunId,
    ai_call_id: aiCallId,
  },
  finalizeError = null,
  usageError = null,
  closeError = null,
}: {
  reservationError?: { message: string } | null;
  reservation?: {
    workflow_step_run_id?: string;
    ai_call_id?: string;
  } | null;
  finalizeError?: { message: string } | null;
  usageError?: { message: string } | null;
  closeError?: { message: string } | null;
} = {}) {
  const calls: string[] = [];
  const userRpc = vi.fn(async (name: string, payload: unknown) => {
    calls.push(`user:rpc:${name}`);
    if (name === "reserve_m1_risk_rerun") {
      return { data: reservation, error: reservationError };
    }
    throw new Error(`Unexpected user RPC ${name}: ${JSON.stringify(payload)}`);
  });
  const adminRpc = vi.fn(async (name: string, payload: unknown) => {
    calls.push(`admin:rpc:${name}`);
    if (name === "finalize_m1_risk_rerun") {
      return { data: null, error: finalizeError, payload };
    }
    if (name === "record_m1_risk_ai_usage") {
      return { data: null, error: usageError, payload };
    }
    if (name === "close_m1_risk_ai_reservation") {
      return { data: null, error: closeError, payload };
    }
    throw new Error(`Unexpected admin RPC ${name}`);
  });

  const from = vi.fn((table: string) => {
    calls.push(`from:${table}`);
    if (table === "projects") {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: projectId }, error: null }),
          }),
        }),
      };
    }
    if (table === "answers") {
      return {
        select: () => ({
          eq: async () => ({
            data: [{ question_id: "object", value: { type: "flat" } }],
            error: null,
          }),
        }),
      };
    }
    if (table === "workflow_runs") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: { id: workflowRunId },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table mutation/query: ${table}`);
  });

  return {
    client: { from, rpc: userRpc },
    adminClient: { rpc: adminRpc },
    calls,
    from,
    userRpc,
    adminRpc,
  };
}

const pipelineResult = {
  passport: { object: { type: "flat", area_m2: 40, city: "Москва" } },
  cards: [],
  llmOk: true,
  llmUsage: {
    provider: "yandex",
    model: "yandexgpt-lite",
    tokensIn: 120,
    tokensOut: 48,
    durationMs: 350,
    providerCostEstimate: 0.42,
    estimateSource: "provider_pricing",
    outcome: "success",
  },
};

describe("rerunRisks governed AI accounting behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runRiskPipeline.mockResolvedValue(pipelineResult);
  });

  it("reserves durable accounting before invoking the metered provider", async () => {
    const { client, adminClient, calls, userRpc, adminRpc } = createSupabase();
    mocks.createClient.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(adminClient);
    mocks.runRiskPipeline.mockImplementation(async () => {
      calls.push("provider");
      return pipelineResult;
    });

    await expect(rerunRisks(projectId)).resolves.toEqual({ ok: true, llmOk: true });

    expect(calls.indexOf("user:rpc:reserve_m1_risk_rerun")).toBeLessThan(
      calls.indexOf("provider"),
    );
    expect(calls.indexOf("provider")).toBeLessThan(
      calls.indexOf("admin:rpc:record_m1_risk_ai_usage"),
    );
    expect(calls.indexOf("admin:rpc:record_m1_risk_ai_usage")).toBeLessThan(
      calls.indexOf("admin:rpc:finalize_m1_risk_rerun"),
    );
    expect(userRpc).toHaveBeenNthCalledWith(
      1,
      "reserve_m1_risk_rerun",
      expect.objectContaining({
        p_project_id: projectId,
        p_workflow_run_id: workflowRunId,
      }),
    );
    expect(adminRpc).not.toHaveBeenCalledWith(
      "reserve_m1_risk_rerun",
      expect.anything(),
    );
  });

  it.each([
    [{ message: "reservation failed" }, null],
    [null, null],
    [null, { workflow_step_run_id: stepRunId }],
  ])("does not invoke AI when reservation is unusable", async (error, reservation) => {
    const { client, userRpc } = createSupabase({
      reservationError: error,
      reservation,
    });
    mocks.createClient.mockResolvedValue(client);

    await expect(rerunRisks(projectId)).resolves.toEqual({
      ok: false,
      llmOk: false,
    });

    expect(mocks.runRiskPipeline).not.toHaveBeenCalled();
    expect(userRpc).toHaveBeenCalledTimes(1);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("finalizes the same reservation with usage and business output atomically", async () => {
    const { client, adminClient, from, adminRpc, userRpc } = createSupabase();
    mocks.createClient.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(adminClient);

    await expect(rerunRisks(projectId)).resolves.toEqual({ ok: true, llmOk: true });

    expect(adminRpc).toHaveBeenNthCalledWith(
      2,
      "finalize_m1_risk_rerun",
      expect.objectContaining({
        p_workflow_step_run_id: stepRunId,
        p_ai_call_id: aiCallId,
        p_passport: pipelineResult.passport,
        p_risk_cards: pipelineResult.cards,
        p_provider: pipelineResult.llmUsage.provider,
        p_model: pipelineResult.llmUsage.model,
        p_tokens_in: pipelineResult.llmUsage.tokensIn,
        p_tokens_out: pipelineResult.llmUsage.tokensOut,
        p_duration_ms: pipelineResult.llmUsage.durationMs,
        p_provider_cost_estimate:
          pipelineResult.llmUsage.providerCostEstimate,
        p_estimate_source: pipelineResult.llmUsage.estimateSource,
        p_outcome: pipelineResult.llmUsage.outcome,
      }),
    );
    expect(userRpc).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalledWith("ai_calls");
    expect(from).not.toHaveBeenCalledWith("risk_cards");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/dashboard/projects/${projectId}`,
    );
  });

  it("does not report success when atomic finalization fails", async () => {
    const { client, adminClient, adminRpc } = createSupabase({
      finalizeError: { message: "finalize failed" },
    });
    mocks.createClient.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(adminClient);

    await expect(rerunRisks(projectId)).resolves.toEqual({
      ok: false,
      llmOk: true,
    });
    expect(adminRpc).toHaveBeenNthCalledWith(
      3,
      "close_m1_risk_ai_reservation",
      expect.objectContaining({
        p_workflow_step_run_id: stepRunId,
        p_ai_call_id: aiCallId,
        p_provider_completed: true,
        p_tokens_in: pipelineResult.llmUsage.tokensIn,
        p_provider_cost_estimate:
          pipelineResult.llmUsage.providerCostEstimate,
        p_error: { code: "risk_finalize_failed" },
      }),
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("persists charged usage before business finalization", async () => {
    const { client, adminClient, adminRpc, userRpc } = createSupabase();
    mocks.createClient.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(adminClient);

    await rerunRisks(projectId);

    expect(adminRpc).toHaveBeenNthCalledWith(
      1,
      "record_m1_risk_ai_usage",
      expect.objectContaining({
        p_ai_call_id: aiCallId,
        p_tokens_in: pipelineResult.llmUsage.tokensIn,
        p_provider_cost_estimate:
          pipelineResult.llmUsage.providerCostEstimate,
      }),
    );
    expect(adminRpc).toHaveBeenNthCalledWith(
      2,
      "finalize_m1_risk_rerun",
      expect.any(Object),
    );
    expect(userRpc).not.toHaveBeenCalledWith(
      "record_m1_risk_ai_usage",
      expect.anything(),
    );
    expect(userRpc).not.toHaveBeenCalledWith(
      "finalize_m1_risk_rerun",
      expect.anything(),
    );
  });

  it("returns a distinct error when usage and fallback terminalization both fail", async () => {
    const { client, adminClient } = createSupabase({
      usageError: { message: "usage unavailable" },
      closeError: { message: "close unavailable" },
    });
    mocks.createClient.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(adminClient);

    await expect(rerunRisks(projectId)).resolves.toEqual({
      ok: false,
      llmOk: true,
      error: "usage_terminalization_failed",
    });
  });

  it("abandons the durable reservation when the pipeline throws before usage is returned", async () => {
    const { client, adminClient, adminRpc } = createSupabase();
    mocks.createClient.mockResolvedValue(client);
    mocks.createAdminClient.mockReturnValue(adminClient);
    mocks.runRiskPipeline.mockRejectedValue(new Error("pipeline crashed"));

    await expect(rerunRisks(projectId)).resolves.toEqual({
      ok: false,
      llmOk: false,
    });

    expect(adminRpc).toHaveBeenNthCalledWith(
      1,
      "close_m1_risk_ai_reservation",
      expect.objectContaining({
        p_workflow_step_run_id: stepRunId,
        p_ai_call_id: aiCallId,
        p_provider_completed: false,
        p_error: { code: "risk_pipeline_failed" },
      }),
    );
  });
});
