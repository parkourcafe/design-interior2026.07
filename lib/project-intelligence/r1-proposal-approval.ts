export function assertR1ProposalApproval(input: { readonly status: "approved" | "rejected" | "pending"; readonly proposalRevisionId: string; readonly approvedRevisionId: string; readonly selfApproved: boolean }) {
  if (input.status !== "approved" || !input.proposalRevisionId || input.proposalRevisionId !== input.approvedRevisionId) throw new Error("r1_proposal_approval_required");
  return { selfApproved: input.selfApproved };
}
