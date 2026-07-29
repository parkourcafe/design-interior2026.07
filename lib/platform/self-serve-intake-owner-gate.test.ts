import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const projectInsertSingle = vi.fn().mockResolvedValue({
    data: { id: "unassigned-project" },
    error: null,
  });
  const projectInsertSelect = vi.fn(() => ({ single: projectInsertSingle }));
  const projectInsert = vi.fn(() => ({ select: projectInsertSelect }));
  const eventInsert = vi.fn().mockResolvedValue({ error: null });
  const admin = {
    from: vi.fn((table: string) =>
      table === "projects"
        ? { insert: projectInsert }
        : { insert: eventInsert },
    ),
  };

  return {
    admin,
    checkRateLimit: vi.fn().mockResolvedValue(true),
    clientIp: vi.fn(() => "127.0.0.1"),
    createAdminClient: vi.fn(() => admin),
    deriveIdentity: vi.fn(() => ({
      answerDigest: "a".repeat(64),
      idempotencyKey: "b".repeat(64),
    })),
    declaredRequestTooLarge: vi.fn(() => false),
    finalize: vi.fn(),
    getProject: vi.fn(),
    makeToken: vi.fn(() => "unassigned-token"),
    parseInput: vi.fn(() => ({
      token: "intake-token",
      answers: { object: { type: "flat", area_m2: 80, city: "Москва" } },
    })),
    pipeline: vi.fn(),
    readBoundedBody: vi.fn().mockResolvedValue("{}"),
    recordUsage: vi.fn(),
    reserve: vi.fn(),
    close: vi.fn(),
  };
});

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
  clientIp: mocks.clientIp,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/tokens", () => ({ makeToken: mocks.makeToken }));
vi.mock("@/lib/intake", () => ({
  getProjectByIntakeToken: mocks.getProject,
}));
vi.mock("@/lib/brief/pipeline", () => ({
  runRiskPipeline: mocks.pipeline,
}));
vi.mock("@/lib/platform/initial-brief-input-validation", () => ({
  declaredInitialBriefRequestTooLarge: mocks.declaredRequestTooLarge,
  InitialBriefRequestTooLargeError: class extends Error {},
  parseInitialBriefInput: mocks.parseInput,
  readBoundedInitialBriefBody: mocks.readBoundedBody,
}));
vi.mock("@/lib/platform/initial-brief-request-identity", () => ({
  deriveInitialBriefRequestIdentity: mocks.deriveIdentity,
}));
vi.mock("@/lib/platform/m1-workflow", () => ({
  closeInitialBriefAiCall: mocks.close,
  finalizeInitialBrief: mocks.finalize,
  recordInitialBriefAiUsage: mocks.recordUsage,
  reserveInitialBriefAiCall: mocks.reserve,
}));

import { POST as createSelfServeBrief } from "@/app/api/client/create/route";
import { POST as submitInitialBrief } from "@/app/api/intake/submit/route";

const migrationSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
  ),
  "utf8",
);

function sqlFunction(name: string): string {
  const start = migrationSource.search(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
      "i",
    ),
  );
  if (start < 0) return "";

  const tail = migrationSource.slice(start);
  const bodyTag = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!bodyTag?.[1] || bodyTag.index === undefined) return "";
  const bodyEnd = tail.indexOf(
    bodyTag[1],
    bodyTag.index + bodyTag[0].length,
  );
  return bodyEnd < 0 ? "" : tail.slice(0, bodyEnd + bodyTag[1].length);
}

describe("self-serve intake owner gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue(true);
    mocks.parseInput.mockReturnValue({
      token: "intake-token",
      answers: { object: { type: "flat", area_m2: 80, city: "Москва" } },
    });
    mocks.reserve.mockResolvedValue({
      ok: true,
      workflowRunId: "00000000-0000-4000-8000-000000000002",
      workflowStepRunId: "00000000-0000-4000-8000-000000000003",
      aiCallId: "00000000-0000-4000-8000-000000000004",
      replayed: true,
      resultSnapshot: {
        ok: true,
        llmOk: true,
        workflowRunId: "00000000-0000-4000-8000-000000000002",
      },
    });
  });

  it("does not create an ownerless project while governed review has no human owner", async () => {
    const response = await createSelfServeBrief();

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "self_serve_intake_unavailable",
      error: expect.any(String),
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.makeToken).not.toHaveBeenCalled();
  });

  it("rejects a legacy ownerless token before identity, reservation, or paid AI", async () => {
    mocks.getProject.mockResolvedValue({
      id: "unassigned-project",
      designer_id: null,
      client_name: "",
      status: "created",
      custom_questions: [],
    });

    const response = await submitInitialBrief(
      new Request("http://localhost/api/intake/submit", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "intake_owner_required" });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.deriveIdentity).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it("preserves the designer-issued token flow", async () => {
    mocks.getProject.mockResolvedValue({
      id: "assigned-project",
      designer_id: "00000000-0000-4000-8000-000000000001",
      client_name: "Клиент",
      status: "created",
      custom_questions: [],
    });
    mocks.reserve.mockResolvedValue({
      ok: true,
      workflowRunId: "00000000-0000-4000-8000-000000000002",
      workflowStepRunId: "00000000-0000-4000-8000-000000000003",
      aiCallId: "00000000-0000-4000-8000-000000000004",
      replayed: true,
      resultSnapshot: {
        ok: true,
        llmOk: true,
        workflowRunId: "00000000-0000-4000-8000-000000000002",
      },
    });

    const response = await submitInitialBrief(
      new Request("http://localhost/api/intake/submit", {
        method: "POST",
        body: "{}",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      llmOk: true,
      workflowRunId: "00000000-0000-4000-8000-000000000002",
    });
    expect(mocks.deriveIdentity).toHaveBeenCalledWith(
      "assigned-project",
      expect.any(Object),
    );
    expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it("rejects a null project owner inside the reservation RPC before ledger access", () => {
    const reserve = sqlFunction("reserve_initial_brief_ai_call");
    const ownerGuard = reserve.search(
      /if\s+v_initiated_by\s+is\s+null\s+then[\s\S]{0,160}?raise\s+exception\s+'initial_brief_owner_required'/i,
    );
    const firstLedgerAccess = reserve.search(
      /(?:from\s+public\.ai_calls|insert\s+into\s+public\.workflow_runs|insert\s+into\s+public\.workflow_step_runs|insert\s+into\s+public\.ai_calls)/i,
    );

    expect(reserve, "reservation RPC must exist").not.toBe("");
    expect(ownerGuard).toBeGreaterThanOrEqual(0);
    expect(firstLedgerAccess).toBeGreaterThan(ownerGuard);
  });
});
