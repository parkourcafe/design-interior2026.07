export type ProposalProjectStatus =
  | "created"
  | "brief_sent"
  | "brief_in_progress"
  | "brief_completed"
  | "proposal_draft"
  | "proposal_sent"
  | "proposal_accepted"
  | "active_project";

const PROPOSAL_STAGE_RANK: Readonly<Partial<Record<ProposalProjectStatus, number>>> = {
  brief_completed: 0,
  proposal_draft: 1,
  proposal_sent: 2,
  proposal_accepted: 3,
};

export function canAdvanceProposalProjectStatus(
  current: string,
  target: "proposal_draft" | "proposal_sent" | "proposal_accepted",
): boolean {
  const currentRank = PROPOSAL_STAGE_RANK[current as ProposalProjectStatus];
  const targetRank = PROPOSAL_STAGE_RANK[target];
  return currentRank !== undefined && targetRank !== undefined && currentRank < targetRank;
}
