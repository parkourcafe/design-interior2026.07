import { describe, expect, it } from "vitest";
import {
  transitionProposalEditorApprovalState,
  type ProposalEditorApprovalState,
} from "./proposal-approval";

const approvedState: ProposalEditorApprovalState = {
  releaseApproved: true,
  authorApproved: true,
};

describe("ProposalEditor approval state transitions", () => {
  it("invalidates both approvals only after a successful rebuild", () => {
    expect(
      transitionProposalEditorApprovalState(approvedState, "rebuild_succeeded"),
    ).toEqual({
      releaseApproved: false,
      authorApproved: false,
    });
  });

  it("preserves approvals when rebuild fails", () => {
    expect(
      transitionProposalEditorApprovalState(approvedState, "rebuild_failed"),
    ).toEqual(approvedState);
  });

  it("returns a new value instead of mutating existing UI state", () => {
    const state = { ...approvedState };

    const next = transitionProposalEditorApprovalState(
      state,
      "rebuild_succeeded",
    );

    expect(state).toEqual(approvedState);
    expect(next).not.toBe(state);
  });
});
