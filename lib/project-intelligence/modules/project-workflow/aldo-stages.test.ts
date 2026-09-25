import { describe, expect, it } from "vitest";

import { AldoStageContractError, deriveAldoStage, type AldoStageRevision } from "./aldo-stages";

const base: AldoStageRevision = {
  revisionId: "stage-01-r1",
  stageId: "01_brief",
  resultRevisionId: null,
  owner: { actorId: "designer-1", displayName: "Дизайнер" },
  plannedAt: "2026-09-24T08:00:00+05:00",
  actualAt: null,
  blockerReason: null,
  requirements: [{ id: "brief", label: "Версия брифа", satisfied: true }],
  approval: null,
  notApplicable: null,
};

describe("deriveAldoStage", () => {
  it("does not permit a result to bypass required approval", () => {
    expect(deriveAldoStage({ ...base, resultRevisionId: "passport-v1" })).toMatchObject({
      status: "awaiting_approval",
      nextAction: "request_approval",
    });
  });

  it("keeps a returned exact version in needs_changes", () => {
    expect(deriveAldoStage({
      ...base,
      resultRevisionId: "passport-v1",
      approval: { status: "change_requested", exactRevisionId: "passport-v1" },
    })).toMatchObject({ status: "needs_changes", nextAction: "address_changes" });
  });

  it("requires the approval to bind to the exact result revision", () => {
    expect(() => deriveAldoStage({
      ...base,
      resultRevisionId: "passport-v2",
      approval: { status: "approved", exactRevisionId: "passport-v1" },
    })).toThrow(new AldoStageContractError("STAGE_APPROVAL_RESULT_MISMATCH"));
  });

  it("preserves an auditable not-applicable decision without treating it as a missing approval", () => {
    expect(deriveAldoStage({
      ...base,
      stageId: "06_preconstruction",
      notApplicable: {
        reason: "Подрядчик уже назначен по существующему договору.",
        decidedBy: { actorId: "owner-1", displayName: "Заказчик" },
      },
    })).toMatchObject({ status: "completed", blocked: false, nextAction: "continue_next_stage" });
  });

  it("keeps a blocker separate from the lifecycle status", () => {
    expect(deriveAldoStage({ ...base, blockerReason: "Ожидается план помещения." })).toMatchObject({
      status: "not_started",
      blocked: true,
      nextAction: "unblock",
    });
  });
});
