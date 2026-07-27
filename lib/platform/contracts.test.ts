import { describe, expect, it } from "vitest";
import { M1_ACTIONS, approvalPresentation, canCreateFactStatus, canTransitionWorkflow, nextFactVersion } from "./contracts";

describe("platform contracts", () => {
  it("forbids AI human confirmation", () => {
    expect(canCreateFactStatus("ai", "human_confirmed")).toBe(false);
    expect(canCreateFactStatus("human", "human_confirmed")).toBe(true);
  });
  it("enforces workflow state machine and retry", () => {
    expect(canTransitionWorkflow("queued", "running")).toBe(true);
    expect(canTransitionWorkflow("failed", "retrying")).toBe(true);
    expect(canTransitionWorkflow("completed", "running")).toBe(false);
  });
  it("creates immutable fact versions", () => {
    expect(nextFactVersion({ id: "old", version: 2 })).toEqual({ version: 3, supersedes_id: "old" });
  });
  it("registers only the eight M1 actions with explicit writes", () => {
    expect(Object.keys(M1_ACTIONS)).toHaveLength(8);
    expect(M1_ACTIONS.issue_proposal.approval).toBe("release_authorized");
    expect(M1_ACTIONS.calculate_fee.costClass).toBe("free_deterministic");
    expect(Object.values(M1_ACTIONS).every((action) => action.writes.length > 0)).toBe(true);
  });
  it("never presents self approval as independent review", () => {
    expect(approvalPresentation("u1", "u1")).toEqual({
      selfApproved: true,
      label: "Подтверждено автором действия",
    });
  });
});
