export function planM1RuntimeProgress(milestone: string) {
  if (milestone === "proposal_draft_ready") {
    return {
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
    };
  }

  return { completedActionKeys: [], nextAction: null };
}
