import { describe, expect, it } from "vitest";
import { M1_ACTIONS } from "./contracts";

describe("M1 skill registry cost-class contract", () => {
  it("meters only the M1 action that currently invokes the LLM provider", () => {
    const meteredActions = Object.values(M1_ACTIONS)
      .filter((action) => action.costClass === "metered_ai")
      .map((action) => action.key)
      .sort();

    expect(meteredActions).toEqual(["generate_risk_register"]);

    expect({
      extract_client_brief: M1_ACTIONS.extract_client_brief.costClass,
      generate_clarifying_questions: M1_ACTIONS.generate_clarifying_questions.costClass,
      build_project_passport: M1_ACTIONS.build_project_passport.costClass,
      build_scope_draft: M1_ACTIONS.build_scope_draft.costClass,
      calculate_fee: M1_ACTIONS.calculate_fee.costClass,
      generate_proposal_draft: M1_ACTIONS.generate_proposal_draft.costClass,
      issue_proposal: M1_ACTIONS.issue_proposal.costClass,
    }).toEqual({
      extract_client_brief: "free_deterministic",
      generate_clarifying_questions: "free_deterministic",
      build_project_passport: "free_deterministic",
      build_scope_draft: "free_deterministic",
      calculate_fee: "free_deterministic",
      generate_proposal_draft: "free_deterministic",
      issue_proposal: "free_deterministic",
    });
  });
});
