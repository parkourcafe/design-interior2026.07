import { describe, expect, it } from "vitest";
import {
  approveProposalRevision,
  isProposalApprovalValid,
  saveProposalRevision,
  type ProposalRevision,
} from "./proposal-approval";

const draftRevision: ProposalRevision = {
  id: "revision-1",
  proposalId: "proposal-1",
  version: 1,
  status: "draft",
  content: {
    scope: "Эскизный проект",
    priceRub: 250_000,
  },
};

describe("proposal approval revisions", () => {
  it("binds an approval to the exact immutable proposal revision", () => {
    const approval = approveProposalRevision({
      revision: draftRevision,
      approvedBy: "designer-1",
    });

    expect(approval.proposalId).toBe(draftRevision.proposalId);
    expect(approval.revisionId).toBe(draftRevision.id);
    expect(isProposalApprovalValid(approval, draftRevision)).toBe(true);
  });

  it("invalidates an old approval after changed proposal content is saved as a new revision", () => {
    const approval = approveProposalRevision({
      revision: draftRevision,
      approvedBy: "designer-1",
    });

    const changedRevision = saveProposalRevision({
      current: draftRevision,
      content: {
        scope: "Полный дизайн-проект",
        priceRub: 320_000,
      },
    });

    expect(changedRevision.id).not.toBe(draftRevision.id);
    expect(changedRevision.version).toBe(2);
    expect(changedRevision.proposalId).toBe(draftRevision.proposalId);
    expect(isProposalApprovalValid(approval, changedRevision)).toBe(false);
    expect(isProposalApprovalValid(approval, draftRevision)).toBe(true);
  });

  it("does not allow a sent proposal revision to be saved", () => {
    expect(() =>
      saveProposalRevision({
        current: {
          ...draftRevision,
          status: "sent",
        },
        content: {
          scope: "Изменённый состав работ",
          priceRub: 250_000,
        },
      }),
    ).toThrow(/sent|отправлен/i);
  });
});
