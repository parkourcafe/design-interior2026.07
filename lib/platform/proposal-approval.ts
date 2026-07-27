export type ProposalRevisionStatus = "draft" | "sent";

export type ProposalContent = {
  readonly scope: string;
  readonly priceRub: number;
};

export type ProposalRevision = {
  readonly id: string;
  readonly proposalId: string;
  readonly version: number;
  readonly status: ProposalRevisionStatus;
  readonly content: ProposalContent;
};

export type ProposalApproval = {
  readonly proposalId: string;
  readonly revisionId: string;
  readonly approvedBy: string;
};

export type ProposalEditorApprovalState = {
  readonly releaseApproved: boolean;
  readonly authorApproved: boolean;
};

export type ProposalEditorApprovalEvent =
  | "rebuild_succeeded"
  | "rebuild_failed";

export function transitionProposalEditorApprovalState(
  current: ProposalEditorApprovalState,
  event: ProposalEditorApprovalEvent,
): ProposalEditorApprovalState {
  if (event === "rebuild_succeeded") {
    return {
      releaseApproved: false,
      authorApproved: false,
    };
  }

  return { ...current };
}

export function approveProposalRevision({
  revision,
  approvedBy,
}: {
  revision: ProposalRevision;
  approvedBy: string;
}): ProposalApproval {
  return {
    proposalId: revision.proposalId,
    revisionId: revision.id,
    approvedBy,
  };
}

export function isProposalApprovalValid(
  approval: ProposalApproval,
  revision: ProposalRevision,
): boolean {
  return (
    approval.proposalId === revision.proposalId &&
    approval.revisionId === revision.id
  );
}

export function saveProposalRevision({
  current,
  content,
}: {
  current: ProposalRevision;
  content: ProposalContent;
}): ProposalRevision {
  if (current.status === "sent") {
    throw new Error("A sent proposal revision cannot be changed");
  }

  const version = current.version + 1;

  return {
    id: `${current.proposalId}-revision-${version}`,
    proposalId: current.proposalId,
    version,
    status: "draft",
    content: { ...content },
  };
}
