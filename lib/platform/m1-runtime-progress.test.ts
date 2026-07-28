import { describe, expect, it } from "vitest";
import { planM1RuntimeProgress } from "./m1-runtime-progress";

describe("planM1RuntimeProgress", () => {
  it("plans completed M1 actions in canonical order and blocks proposal issuance pending human release approval", () => {
    expect(planM1RuntimeProgress("proposal_draft_ready")).toEqual({
      completedActionKeys: [
        "extract_client_brief",
        "generate_clarifying_questions",
        "build_project_passport",
        "generate_risk_register",
        "build_scope_draft",
        "calculate_fee",
        "generate_proposal_draft",
      ],
      nextAction: {
        key: "issue_proposal",
        status: "blocked",
        blockedBy: "human_release_approval",
      },
    });
  });
});
