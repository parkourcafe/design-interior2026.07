import { describe, expect, it } from "vitest";
import { readPassportApproval } from "./passport-approval";

const P = "11111111-1111-4111-8111-111111111111";

function client(result: { data: unknown; error: unknown }) {
  const calls: unknown[] = [];
  return {
    calls,
    schema: (name: string) => ({
      rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ name, fn, args }); return result; },
    }),
  };
}

const row = (over: Record<string, unknown>) => ({
  requestId: "r1", subjectKind: "project_passport", subjectId: P, status: "draft",
  subjectRevisionCurrent: true, requestedByCurrentActor: true, ...over,
});

describe("readPassportApproval", () => {
  it("treats a refused read as a project that is not enrolled yet", async () => {
    expect(await readPassportApproval(client({ data: null, error: { code: "P1103" } }), P)).toEqual({ state: "not_enrolled" });
  });

  it("is approved only for the current passport revision", async () => {
    expect(await readPassportApproval(client({ data: { requests: [row({ status: "approved" })] }, error: null }), P))
      .toEqual({ state: "approved" });
    expect(await readPassportApproval(client({
      data: { requests: [row({ status: "approved", subjectRevisionCurrent: false })] }, error: null,
    }), P)).toEqual({ state: "pending", request: null });
  });

  it("resumes the designer's own unfinished request instead of creating another", async () => {
    const result = await readPassportApproval(client({
      data: { requests: [row({ requestId: "old", status: "rejected" }), row({ requestId: "mine", status: "submitted" })] },
      error: null,
    }), P);
    expect(result).toEqual({ state: "pending", request: { requestId: "mine", status: "submitted" } });
  });

  it("does not resume someone else's request", async () => {
    const result = await readPassportApproval(client({
      data: { requests: [row({ requestedByCurrentActor: false })] }, error: null,
    }), P);
    expect(result).toEqual({ state: "pending", request: null });
  });

  it("reads all statuses through the request-bound platform API", async () => {
    const c = client({ data: { requests: [] }, error: null });
    await readPassportApproval(c, P);
    expect(c.calls).toEqual([{ name: "projectceo_platform_api", fn: "list_approval_requests", args: { p_project_id: P, p_status: null } }]);
  });
});
