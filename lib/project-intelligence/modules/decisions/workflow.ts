import { canonicalJson } from "../../application/change-handoff/canonical";
import { compareCodePoints } from "../../ordering";
import type {
  ApprovalPackage,
  ApprovalPackageItem,
  ApprovalPackageReview,
  EvidenceReference,
  HumanActorRef,
  PriceObservation,
  RevisionActorRef,
  RevisionClaimStatus,
  RevisionEntity,
  RevisionIdentity,
  SelectionRevision,
} from "./contracts";
import {
  REVISION_CLAIM_STATUSES,
  REVISION_REVIEW_STATUSES,
} from "./contracts";

export class DecisionContractError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DecisionContractError";
  }
}

function immutable<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(cloned);
  return cloned;
}

function nonEmpty(value: string, code: string): void {
  if (!value || value !== value.trim()) {
    throw new DecisionContractError(code, `${code}: value must be non-empty and trimmed.`);
  }
}

function validTime(value: string, code: string): void {
  if (!Number.isFinite(Date.parse(value)) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new DecisionContractError(code, `${code}: timestamp must include an offset.`);
  }
}

function validateActor(actor: HumanActorRef): void {
  if (actor.actorType !== "human") {
    throw new DecisionContractError("HUMAN_ACTOR_REQUIRED", "Only a human actor may perform this operation.");
  }
  nonEmpty(actor.actorId, "ACTOR_ID_REQUIRED");
}

function validateRevisionActor(actor: RevisionActorRef): void {
  if (actor.actorType !== "human" && actor.actorType !== "system") {
    throw new DecisionContractError(
      "REVISION_ACTOR_INVALID",
      "Revision actor must be human or system.",
    );
  }
  nonEmpty(actor.actorId, "ACTOR_ID_REQUIRED");
}

function validateEvidence(evidence: EvidenceReference): void {
  nonEmpty(evidence.evidenceId, "EVIDENCE_ID_REQUIRED");
  nonEmpty(evidence.sourceId, "SOURCE_ID_REQUIRED");
  nonEmpty(evidence.sourceRevisionId, "SOURCE_REVISION_REQUIRED");
  if (evidence.fragmentId !== undefined) nonEmpty(evidence.fragmentId, "FRAGMENT_ID_INVALID");
}

function validateIdentity(identity: RevisionIdentity): void {
  nonEmpty(identity.revisionId, "REVISION_ID_REQUIRED");
  if (!Number.isSafeInteger(identity.revisionNo) || identity.revisionNo < 1) {
    throw new DecisionContractError("REVISION_NO_INVALID", "Revision number must be a positive safe integer.");
  }
  validTime(identity.createdAt, "REVISION_TIME_INVALID");
  validateRevisionActor(identity.createdBy);
  nonEmpty(identity.reason, "REVISION_REASON_REQUIRED");
}

function validateClaimOrigin(
  claimStatus: RevisionClaimStatus,
  evidence: readonly EvidenceReference[],
  createdBy: RevisionActorRef,
): void {
  evidence.forEach(validateEvidence);
  if (claimStatus === "human_origin" && createdBy.actorType !== "human") {
    throw new DecisionContractError(
      "HUMAN_ORIGIN_REQUIRES_HUMAN_ACTOR",
      "A human-origin revision must be created by a human actor.",
    );
  }
  if (claimStatus !== "human_origin" && evidence.length === 0) {
    throw new DecisionContractError(
      "NON_HUMAN_REVISION_REQUIRES_EVIDENCE",
      "Extracted, interpreted and unknown revisions require exact source evidence.",
    );
  }
  if (claimStatus === "unknown" && evidence.length === 0) {
    throw new DecisionContractError(
      "UNKNOWN_REVISION_REQUIRES_SOURCE",
      "An unknown claim still records the source that could not be resolved.",
    );
  }
}

function validateSafeRub(amountRub: number): void {
  if (!Number.isSafeInteger(amountRub) || amountRub < 0) {
    throw new DecisionContractError(
      "PRICE_RUB_INVALID",
      "Price observations must be non-negative safe integer roubles.",
    );
  }
}

export function validateRevisionEntity<T extends RevisionEntity>(revision: T): T {
  for (const [value, code] of [
    [revision.id, "REVISION_ID_REQUIRED"],
    [revision.projectId, "PROJECT_ID_REQUIRED"],
    [revision.entityId, "ENTITY_ID_REQUIRED"],
    [revision.packageId, "PACKAGE_ID_REQUIRED"],
    [revision.reason, "REVISION_REASON_REQUIRED"],
  ] as const) nonEmpty(value, code);
  if (
    !Number.isSafeInteger(revision.revisionNo)
    || revision.revisionNo < 1
    || !(REVISION_CLAIM_STATUSES as readonly string[]).includes(revision.claimStatus)
    || !(REVISION_REVIEW_STATUSES as readonly string[]).includes(revision.reviewStatus)
  ) {
    throw new DecisionContractError("REVISION_CONTRACT_INVALID", revision.id);
  }
  validTime(revision.createdAt, "REVISION_TIME_INVALID");
  validateRevisionActor(revision.createdBy);
  validateClaimOrigin(revision.claimStatus, revision.evidence, revision.createdBy);
  if (
    (revision.revisionNo === 1 && revision.replacesRevisionId !== null)
    || (revision.revisionNo > 1 && !revision.replacesRevisionId)
  ) {
    throw new DecisionContractError(
      "REVISION_REPLACEMENT_INVALID",
      "Only a revision after the first must identify the exact revision it replaces.",
    );
  }

  switch (revision.kind) {
    case "requirement":
      nonEmpty(revision.statement, "REQUIREMENT_STATEMENT_REQUIRED");
      break;
    case "assumption":
      nonEmpty(revision.statement, "ASSUMPTION_STATEMENT_REQUIRED");
      nonEmpty(revision.validationNeeded, "ASSUMPTION_VALIDATION_REQUIRED");
      break;
    case "decision":
      nonEmpty(revision.title, "DECISION_TITLE_REQUIRED");
      nonEmpty(revision.resolution, "DECISION_RESOLUTION_REQUIRED");
      break;
    case "selection":
      nonEmpty(revision.title, "SELECTION_TITLE_REQUIRED");
      nonEmpty(revision.areaId, "AREA_ID_REQUIRED");
      nonEmpty(revision.decisionRevisionId, "DECISION_REVISION_REQUIRED");
      if (Object.keys(revision.specification).length === 0) {
        throw new DecisionContractError(
          "SELECTION_SPECIFICATION_REQUIRED",
          "Selection specification is required.",
        );
      }
      for (const [key, value] of Object.entries(revision.specification)) {
        nonEmpty(key, "SPECIFICATION_KEY_INVALID");
        nonEmpty(value, "SPECIFICATION_VALUE_INVALID");
      }
      revision.priceObservations.forEach((observation) => {
        validateSafeRub(observation.amountRub);
        validateEvidence(observation.evidence);
        if (observation.projectId !== revision.projectId) {
          throw new DecisionContractError(
            "PRICE_OBSERVATION_SCOPE_INVALID",
            observation.id,
          );
        }
      });
      break;
  }
  return immutable(revision);
}

export interface CreateSelectionCandidateInput {
  readonly projectId: string;
  readonly entityId: string;
  readonly title: string;
  readonly areaId: string;
  readonly packageId: string;
  readonly decisionRevisionId: string;
  readonly specification: Readonly<Record<string, string>>;
  readonly claimStatus: RevisionClaimStatus;
  readonly evidence?: readonly EvidenceReference[];
  readonly identity: RevisionIdentity;
}

export function createSelectionCandidate(
  input: CreateSelectionCandidateInput,
): SelectionRevision {
  for (const [value, code] of [
    [input.projectId, "PROJECT_ID_REQUIRED"],
    [input.entityId, "SELECTION_ID_REQUIRED"],
    [input.title, "SELECTION_TITLE_REQUIRED"],
    [input.areaId, "AREA_ID_REQUIRED"],
    [input.packageId, "PACKAGE_ID_REQUIRED"],
    [input.decisionRevisionId, "DECISION_REVISION_REQUIRED"],
  ] as const) nonEmpty(value, code);
  validateIdentity(input.identity);
  const evidence = input.evidence ?? [];
  validateClaimOrigin(input.claimStatus, evidence, input.identity.createdBy);
  if (Object.keys(input.specification).length === 0) {
    throw new DecisionContractError("SELECTION_SPECIFICATION_REQUIRED", "Selection specification is required.");
  }
  for (const [key, value] of Object.entries(input.specification)) {
    nonEmpty(key, "SPECIFICATION_KEY_INVALID");
    nonEmpty(value, "SPECIFICATION_VALUE_INVALID");
  }

  return validateRevisionEntity({
    id: input.identity.revisionId,
    projectId: input.projectId,
    entityId: input.entityId,
    revisionNo: input.identity.revisionNo,
    kind: "selection",
    title: input.title,
    areaId: input.areaId,
    packageId: input.packageId,
    decisionRevisionId: input.decisionRevisionId,
    specification: input.specification,
    claimStatus: input.claimStatus,
    reviewStatus: "draft",
    evidence,
    priceObservations: [],
    createdAt: input.identity.createdAt,
    createdBy: input.identity.createdBy,
    reason: input.identity.reason,
    replacesRevisionId: null,
  });
}

interface ReviseSelectionInput {
  readonly previous: SelectionRevision;
  readonly identity: RevisionIdentity;
  readonly evidence?: readonly EvidenceReference[];
  readonly priceObservations?: readonly PriceObservation[];
  readonly reviewStatus?: SelectionRevision["reviewStatus"];
  readonly title?: string;
  readonly decisionRevisionId?: string;
  readonly specification?: Readonly<Record<string, string>>;
}

function reviseSelection(input: ReviseSelectionInput): SelectionRevision {
  validateIdentity(input.identity);
  if (input.identity.revisionNo !== input.previous.revisionNo + 1) {
    throw new DecisionContractError(
      "REVISION_SEQUENCE_INVALID",
      "A selection revision must increment the previous revision exactly once.",
    );
  }
  const evidence = input.evidence ?? input.previous.evidence;
  validateClaimOrigin(
    input.previous.claimStatus,
    evidence,
    input.identity.createdBy,
  );
  const priceObservations = input.priceObservations ?? input.previous.priceObservations;

  return validateRevisionEntity({
    ...input.previous,
    id: input.identity.revisionId,
    revisionNo: input.identity.revisionNo,
    title: input.title ?? input.previous.title,
    decisionRevisionId: input.decisionRevisionId ?? input.previous.decisionRevisionId,
    specification: input.specification ?? input.previous.specification,
    evidence,
    priceObservations,
    reviewStatus: input.reviewStatus ?? "draft",
    createdAt: input.identity.createdAt,
    createdBy: input.identity.createdBy,
    reason: input.identity.reason,
    replacesRevisionId: input.previous.id,
  });
}

export interface ReviseSelectionCandidateInput {
  readonly previous: SelectionRevision;
  readonly identity: RevisionIdentity;
  readonly title?: string;
  readonly decisionRevisionId?: string;
  readonly specification?: Readonly<Record<string, string>>;
  readonly evidence?: readonly EvidenceReference[];
}

export function reviseSelectionCandidate(
  input: ReviseSelectionCandidateInput,
): SelectionRevision {
  const changed = (
    (input.title !== undefined && input.title !== input.previous.title)
    || (
      input.decisionRevisionId !== undefined
      && input.decisionRevisionId !== input.previous.decisionRevisionId
    )
    || (
      input.specification !== undefined
      && canonicalJson(input.specification) !== canonicalJson(input.previous.specification)
    )
    || (
      input.evidence !== undefined
      && canonicalJson(input.evidence) !== canonicalJson(input.previous.evidence)
    )
  );
  if (!changed) {
    throw new DecisionContractError(
      "SELECTION_CHANGE_REQUIRED",
      "A new selection revision must change at least one controlled field.",
    );
  }
  return reviseSelection({
    previous: input.previous,
    identity: input.identity,
    title: input.title,
    decisionRevisionId: input.decisionRevisionId,
    specification: input.specification,
    evidence: input.evidence,
    priceObservations: [],
    reviewStatus: "draft",
  });
}

export function attachSelectionEvidence(
  previous: SelectionRevision,
  identity: RevisionIdentity,
  evidence: EvidenceReference,
): SelectionRevision {
  validateEvidence(evidence);
  if (previous.evidence.some((item) => item.evidenceId === evidence.evidenceId)) {
    throw new DecisionContractError("DUPLICATE_EVIDENCE", "Evidence is already attached.");
  }
  return reviseSelection({
    previous,
    identity,
    evidence: [...previous.evidence, evidence],
  });
}

export function attachPriceObservation(
  previous: SelectionRevision,
  identity: RevisionIdentity,
  observation: Omit<PriceObservation, "selectionRevisionId">,
): SelectionRevision {
  validateSafeRub(observation.amountRub);
  validTime(observation.observedAt, "PRICE_OBSERVED_AT_INVALID");
  validateEvidence(observation.evidence);
  if (observation.projectId !== previous.projectId) {
    throw new DecisionContractError("PROJECT_SCOPE_VIOLATION", "Price observation project mismatch.");
  }
  if (previous.priceObservations.some((item) => item.id === observation.id)) {
    throw new DecisionContractError("DUPLICATE_PRICE_OBSERVATION", "Price observation already exists.");
  }
  const nextObservation: PriceObservation = {
    ...observation,
    selectionRevisionId: identity.revisionId,
  };
  return reviseSelection({
    previous,
    identity,
    priceObservations: [...previous.priceObservations, nextObservation],
  });
}

export function createApprovalPackage(input: {
  readonly id: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly revisions: readonly RevisionEntity[];
}): ApprovalPackage {
  nonEmpty(input.id, "APPROVAL_PACKAGE_ID_REQUIRED");
  nonEmpty(input.projectId, "PROJECT_ID_REQUIRED");
  nonEmpty(input.packageId, "PACKAGE_ID_REQUIRED");
  if (input.revisions.length === 0) {
    throw new DecisionContractError("APPROVAL_ITEMS_REQUIRED", "Approval package cannot be empty.");
  }
  const items: ApprovalPackageItem[] = input.revisions.map((revision) => {
    if (revision.projectId !== input.projectId || revision.packageId !== input.packageId) {
      throw new DecisionContractError("PROJECT_SCOPE_VIOLATION", "Approval target scope mismatch.");
    }
    const targetKind = `${revision.kind}_revision` as ApprovalPackageItem["targetKind"];
    return {
      targetKind,
      entityId: revision.entityId,
      revisionId: revision.id,
    };
  });
  const unique = new Set(items.map((item) => `${item.targetKind}:${item.revisionId}`));
  if (unique.size !== items.length) {
    throw new DecisionContractError("DUPLICATE_APPROVAL_TARGET", "Approval targets must be unique.");
  }
  items.sort((left, right) => compareCodePoints(canonicalJson(left), canonicalJson(right)));
  return immutable({
    id: input.id,
    projectId: input.projectId,
    packageId: input.packageId,
    items,
    status: "draft",
    submittedAt: null,
    submittedBy: null,
    review: null,
  });
}

export function submitApprovalPackage(
  approvalPackage: ApprovalPackage,
  actor: HumanActorRef,
  submittedAt: string,
): ApprovalPackage {
  if (approvalPackage.status !== "draft") {
    throw new DecisionContractError("INVALID_APPROVAL_TRANSITION", "Only a draft package can be submitted.");
  }
  validateActor(actor);
  validTime(submittedAt, "APPROVAL_SUBMITTED_AT_INVALID");
  return immutable({
    ...approvalPackage,
    status: "submitted",
    submittedAt,
    submittedBy: actor,
  });
}

export function reviewApprovalPackage(
  approvalPackage: ApprovalPackage,
  review: ApprovalPackageReview,
): ApprovalPackage {
  if (approvalPackage.status !== "submitted") {
    throw new DecisionContractError("INVALID_APPROVAL_TRANSITION", "Only a submitted package can be reviewed.");
  }
  validateActor(review.actor);
  validTime(review.reviewedAt, "APPROVAL_REVIEWED_AT_INVALID");
  nonEmpty(review.reason, "APPROVAL_REASON_REQUIRED");
  return immutable({
    ...approvalPackage,
    status: review.decision,
    review,
  });
}

export function supersedeSelection(
  previous: SelectionRevision,
  replacement: SelectionRevision,
): { readonly superseded: SelectionRevision; readonly replacement: SelectionRevision } {
  if (
    replacement.entityId !== previous.entityId
    || replacement.projectId !== previous.projectId
    || replacement.replacesRevisionId !== previous.id
  ) {
    throw new DecisionContractError(
      "INVALID_SUPERSESSION",
      "Replacement must be the next exact revision of the same selection.",
    );
  }
  return immutable({
    superseded: {
      ...previous,
      reviewStatus: "superseded",
    },
    replacement,
  });
}
