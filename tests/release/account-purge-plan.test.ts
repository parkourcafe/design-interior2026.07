import { describe, expect, it } from "vitest";
import { planAccountPurge, type PurgePlanClient } from "../../lib/account-retention/purge-plan";

// DEC-041 §2: план удаления — только dry-run. Он читает блокеры и объём и
// пишет план в журнал заявки; ни одного удаления.

function client(blockers: readonly string[], caseId: string | null = "case-1") {
  const calls: string[] = [];
  const fake: PurgePlanClient = {
    rpc: async (name, args) => {
      calls.push(`rpc:${name}`);
      if (name === "account_purge_blockers") {
        return { data: { caseId, purgeAfter: "2026-12-27T00:00:00Z", blockers }, error: null };
      }
      if (name === "count_passport_revisions") return { data: 3, error: null };
      if (name === "record_account_purge_plan") {
        expect((args.p_plan as { destructive: boolean }).destructive).toBe(false);
        return { data: null, error: null };
      }
      return { data: null, error: { message: "unexpected" } };
    },
    from: (table) => ({
      select: () => ({
        eq: async () => { calls.push(`select:${table}`); return { data: [{ id: "p1" }, { id: "p2" }], error: null }; },
        in: async () => { calls.push(`count:${table}`); return { data: null, count: 2, error: null }; },
      }),
    }),
  };
  return { fake, calls };
}

describe("planAccountPurge (dry-run)", () => {
  it("reports blockers, scope and records the plan without destructive calls", async () => {
    const { fake, calls } = client(["WINDOW_OPEN"]);
    const plan = await planAccountPurge(fake, "designer-1");
    expect(plan).toMatchObject({
      eligible: false, blockers: ["WINDOW_OPEN"], destructive: false,
      scope: { projects: 2, proposals: 2, passportRevisions: 3 },
    });
    expect(plan.scope.storagePrefixes).toEqual([
      "client-uploads/p1/", "client-uploads/designer-plans/p1/",
      "client-uploads/p2/", "client-uploads/designer-plans/p2/",
    ]);
    expect(calls).toContain("rpc:record_account_purge_plan");
    expect(calls.some((call) => /delete|remove|purge_account/.test(call))).toBe(false);
  });

  it("is eligible only without blockers and still does not delete", async () => {
    const { fake } = client([]);
    const plan = await planAccountPurge(fake, "designer-1");
    expect(plan.eligible).toBe(true);
    expect(plan.destructive).toBe(false);
  });
});
