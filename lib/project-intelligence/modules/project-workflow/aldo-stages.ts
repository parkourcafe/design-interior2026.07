export const ALDO_STAGE_IDS = [
  "01_brief",
  "02_concept_offer",
  "03_preliminary_design",
  "04_design_development",
  "05_technical_documentation",
  "06_preconstruction",
  "07_construction_closeout",
] as const;

export type AldoStageId = (typeof ALDO_STAGE_IDS)[number];

export const ALDO_STAGE_STATUSES = [
  "not_started",
  "in_progress",
  "awaiting_approval",
  "needs_changes",
  "completed",
] as const;

export type AldoStageStatus = (typeof ALDO_STAGE_STATUSES)[number];

export interface AldoActorRef {
  readonly actorId: string;
  readonly displayName: string;
}

export interface AldoStageRequirement {
  readonly id: string;
  readonly label: string;
  readonly satisfied: boolean;
}

export interface AldoStageApproval {
  readonly status: "draft" | "submitted" | "approved" | "rejected" | "change_requested";
  readonly exactRevisionId: string;
}

export interface AldoStageRevision {
  readonly revisionId: string;
  readonly stageId: AldoStageId;
  readonly resultRevisionId: string | null;
  readonly owner: AldoActorRef;
  readonly plannedAt: string | null;
  readonly actualAt: string | null;
  readonly blockerReason: string | null;
  readonly requirements: readonly AldoStageRequirement[];
  readonly approval: AldoStageApproval | null;
  readonly notApplicable: { readonly reason: string; readonly decidedBy: AldoActorRef } | null;
}

export interface AldoStageView extends AldoStageRevision {
  readonly status: AldoStageStatus;
  readonly blocked: boolean;
  readonly nextAction: "start_work" | "satisfy_requirement" | "request_approval" | "address_changes" | "unblock" | "continue_next_stage";
}

export class AldoStageContractError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(copy);
  return copy;
}

function required(value: string, code: string): void {
  if (!value.trim()) throw new AldoStageContractError(code);
}

function validTime(value: string | null, code: string): void {
  if (value !== null && (!Number.isFinite(Date.parse(value)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value))) {
    throw new AldoStageContractError(code);
  }
}

function validateRevision(revision: AldoStageRevision): void {
  required(revision.revisionId, "STAGE_REVISION_ID_REQUIRED");
  required(revision.owner.actorId, "STAGE_OWNER_REQUIRED");
  required(revision.owner.displayName, "STAGE_OWNER_NAME_REQUIRED");
  validTime(revision.plannedAt, "STAGE_PLAN_TIME_INVALID");
  validTime(revision.actualAt, "STAGE_ACTUAL_TIME_INVALID");
  if (revision.blockerReason !== null) required(revision.blockerReason, "STAGE_BLOCKER_REASON_REQUIRED");
  if (new Set(revision.requirements.map((item) => item.id)).size !== revision.requirements.length) {
    throw new AldoStageContractError("STAGE_REQUIREMENT_DUPLICATE");
  }
  for (const requirement of revision.requirements) {
    required(requirement.id, "STAGE_REQUIREMENT_ID_REQUIRED");
    required(requirement.label, "STAGE_REQUIREMENT_LABEL_REQUIRED");
  }
  if (revision.approval !== null) {
    required(revision.approval.exactRevisionId, "STAGE_APPROVAL_REVISION_REQUIRED");
    if (revision.resultRevisionId !== revision.approval.exactRevisionId) {
      throw new AldoStageContractError("STAGE_APPROVAL_RESULT_MISMATCH");
    }
  }
  if (revision.notApplicable !== null) {
    required(revision.notApplicable.reason, "STAGE_NOT_APPLICABLE_REASON_REQUIRED");
    required(revision.notApplicable.decidedBy.actorId, "STAGE_NOT_APPLICABLE_ACTOR_REQUIRED");
    if (revision.resultRevisionId !== null || revision.approval !== null) {
      throw new AldoStageContractError("STAGE_NOT_APPLICABLE_HAS_RESULT");
    }
  }
}

/**
 * Derives a stage view solely from persisted evidence. It deliberately accepts
 * no caller-supplied status, so an interface cannot mark a phase complete.
 */
export function deriveAldoStage(revision: AldoStageRevision): AldoStageView {
  validateRevision(revision);
  const incomplete = revision.requirements.some((requirement) => !requirement.satisfied);
  const blocked = revision.blockerReason !== null;
  let status: AldoStageStatus;
  let nextAction: AldoStageView["nextAction"];

  if (revision.notApplicable !== null) {
    status = "completed";
    nextAction = "continue_next_stage";
  } else if (blocked) {
    status = revision.resultRevisionId === null ? "not_started" : "in_progress";
    nextAction = "unblock";
  } else if (revision.resultRevisionId === null) {
    status = "not_started";
    nextAction = "start_work";
  } else if (incomplete) {
    status = "in_progress";
    nextAction = "satisfy_requirement";
  } else if (revision.approval?.status === "change_requested" || revision.approval?.status === "rejected") {
    status = "needs_changes";
    nextAction = "address_changes";
  } else if (revision.approval === null || revision.approval.status === "draft" || revision.approval.status === "submitted") {
    status = "awaiting_approval";
    nextAction = "request_approval";
  } else {
    status = "completed";
    nextAction = "continue_next_stage";
  }

  return immutable({ ...revision, status, blocked, nextAction });
}
