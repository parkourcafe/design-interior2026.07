import { describe, expect, it } from "vitest";
import { canAdvanceProposalProjectStatus } from "../../lib/proposal/status";

describe("proposal project status reconciliation", () => {
  it.each([
    ["brief_completed", "proposal_draft"],
    ["proposal_draft", "proposal_sent"],
    ["proposal_sent", "proposal_accepted"],
  ] as const)("allows the monotonic %s -> %s edge", (current, target) => {
    expect(canAdvanceProposalProjectStatus(current, target)).toBe(true);
  });

  it.each([
    ["brief_completed", "proposal_sent"],
    ["brief_completed", "proposal_accepted"],
    ["proposal_draft", "proposal_accepted"],
  ] as const)("allows the monotonic catch-up %s -> %s", (current, target) => {
    expect(canAdvanceProposalProjectStatus(current, target)).toBe(true);
  });

  it.each([
    ["proposal_sent", "proposal_draft"],
    ["proposal_accepted", "proposal_draft"],
    ["active_project", "proposal_draft"],
    ["proposal_accepted", "proposal_sent"],
    ["active_project", "proposal_sent"],
    ["active_project", "proposal_accepted"],
    ["future_status", "proposal_accepted"],
    ["proposal_draft", "proposal_draft"],
    ["proposal_sent", "proposal_sent"],
    ["proposal_accepted", "proposal_accepted"],
  ] as const)("refuses downgrade or unknown transition %s -> %s", (current, target) => {
    expect(canAdvanceProposalProjectStatus(current, target)).toBe(false);
  });
});
