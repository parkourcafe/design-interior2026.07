import { DecisionContractError } from "../../modules/decisions";
import type {
  HumanActorRef,
  SelectionRevision,
} from "../../modules/decisions";
import type { RoomDesignIntent } from "../../modules/design-intent";
import type { DesignIntentBudget } from "../../modules/design-intent/budget";
import { compareCodePoints, sortedCodePoints } from "../../ordering";

export type M2ApprovalDecision = "approved" | "rejected" | "change_requested";

export interface M2ApprovalSubmission {
  readonly submissionId: string;
  readonly status: "submitted";
  readonly intent: RoomDesignIntent;
  readonly chosenVariantId: string;
  readonly selectionRevisionIds: readonly string[];
  readonly selections: readonly SelectionRevision[];
  readonly budget: DesignIntentBudget;
  readonly submittedBy: HumanActorRef;
  readonly submittedAt: string;
  readonly reason: string;
  readonly review: null;
}

export interface ReviewedM2ApprovalSubmission {
  readonly submissionId: string;
  readonly status: M2ApprovalDecision;
  readonly intent: RoomDesignIntent;
  readonly chosenVariantId: string;
  readonly selectionRevisionIds: readonly string[];
  readonly selections: readonly SelectionRevision[];
  readonly budget: DesignIntentBudget;
  readonly submittedBy: HumanActorRef;
  readonly submittedAt: string;
  readonly reason: string;
  readonly review: {
    readonly status: M2ApprovalDecision;
    readonly reviewedBy: HumanActorRef;
    readonly reviewedAt: string;
    readonly reason: string;
  };
}

export interface CreateM2ApprovalSubmissionInput {
  readonly submissionId: string;
  readonly intent: RoomDesignIntent;
  readonly chosenVariantId: string;
  readonly selectionRevisionIds: readonly string[];
  readonly selections: readonly SelectionRevision[];
  readonly budget: DesignIntentBudget;
  readonly submittedBy: HumanActorRef;
  readonly submittedAt: string;
  readonly reason: string;
}

export interface ReviewM2ApprovalSubmissionInput {
  readonly submission: M2ApprovalSubmission | ReviewedM2ApprovalSubmission;
  readonly decision: M2ApprovalDecision;
  readonly reviewedBy: HumanActorRef;
  readonly reviewedAt: string;
  readonly reason: string;
}

export interface CreateApprovedM2CommitInput {
  readonly approvedSubmission: M2ApprovalSubmission | ReviewedM2ApprovalSubmission;
  readonly currentIntent: RoomDesignIntent;
  readonly currentSelections: readonly SelectionRevision[];
  readonly recalculatedBudget: DesignIntentBudget;
}

export interface ApprovedM2Commit {
  readonly projectId: string;
  readonly packageId: string;
  readonly roomId: string;
  readonly designIntentRevisionId: string;
  readonly chosenVariant: RoomDesignIntent["variants"][number];
  readonly approvedSelectionRevisionIds: readonly string[];
  readonly selections: readonly SelectionRevision[];
  readonly budget: {
    readonly asOf: string;
    readonly staleAfterDays: number;
    readonly variantId: string;
    readonly amountRub: number;
    readonly staleSelectionRevisionIds: readonly string[];
    readonly missingPriceSelectionRevisionIds: readonly string[];
  };
  readonly submittedBy: HumanActorRef;
  readonly reviewedBy: HumanActorRef;
  readonly submittedAt: string;
  readonly reviewedAt: string;
  readonly submissionReason: string;
  readonly reviewReason: string;
}

function fail(code: string, message: string): never {
  throw new DecisionContractError(code, message);
}

function immutable<T>(value: T): T {
  const result = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(result);
  return result;
}

function nonEmpty(value: string, code: string): void {
  if (!value || value !== value.trim()) fail(code, `${code}: value must be non-empty and trimmed.`);
}

function timestamp(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || !/(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    fail(code, `${code}: timestamp must include an offset.`);
  }
  return parsed;
}

function human(actor: HumanActorRef): void {
  if (actor?.actorType !== "human") {
    fail("M2_APPROVAL_HUMAN_REQUIRED", "M2 approval operations require a human actor.");
  }
  nonEmpty(actor.actorId, "M2_APPROVAL_ACTOR_REQUIRED");
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = sortedCodePoints(left);
  const b = sortedCodePoints(right);
  return a.every((value, index) => value === b[index]);
}

function chosenBudget(budget: DesignIntentBudget, variantId: string) {
  return budget.variantBudgets.find((candidate) => candidate.variantId === variantId);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => structurallyEqual(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort(compareCodePoints);
  const rightKeys = Object.keys(rightRecord).sort(compareCodePoints);
  return sameStrings(leftKeys, rightKeys)
    && leftKeys.every((key) => structurallyEqual(leftRecord[key], rightRecord[key]));
}

export function createM2ApprovalSubmission(
  input: CreateM2ApprovalSubmissionInput,
): M2ApprovalSubmission {
  human(input.submittedBy);
  nonEmpty(input.submissionId, "M2_APPROVAL_SUBMISSION_ID_REQUIRED");
  nonEmpty(input.reason, "M2_APPROVAL_REASON_REQUIRED");
  timestamp(input.submittedAt, "M2_APPROVAL_INVALID_TIMESTAMP");

  const variant = input.intent.variants.find((candidate) => candidate.variantId === input.chosenVariantId);
  if (!variant) fail("M2_APPROVAL_VARIANT_NOT_IN_INTENT", "The chosen variant is not in the submitted Design Intent.");
  if (
    variant.projectId !== input.intent.projectId
    || variant.packageId !== input.intent.packageId
    || variant.roomId !== input.intent.roomId
  ) fail("M2_APPROVAL_SCOPE_MISMATCH", "The chosen variant must share the Design Intent scope.");

  const uniqueIds = new Set(input.selectionRevisionIds);
  if (uniqueIds.size !== input.selectionRevisionIds.length) {
    fail("M2_APPROVAL_DUPLICATE_SELECTION", "Selection revision IDs must be unique.");
  }
  const selectionsById = new Map<string, SelectionRevision>();
  for (const selection of input.selections) {
    if (selectionsById.has(selection.id)) fail("M2_APPROVAL_DUPLICATE_SELECTION", "Selections must be unique.");
    selectionsById.set(selection.id, selection);
    if (
      selection.projectId !== input.intent.projectId
      || selection.packageId !== input.intent.packageId
      || selection.areaId !== input.intent.roomId
    ) fail("M2_APPROVAL_SCOPE_MISMATCH", "Selections must share the Design Intent scope.");
    if (selection.reviewStatus !== "approved") {
      fail("M2_APPROVAL_SELECTION_NOT_APPROVED", "Every submitted selection revision must already be approved.");
    }
  }
  if (!sameStrings(input.selectionRevisionIds, [...selectionsById.keys()])) {
    fail("M2_APPROVAL_SELECTION_SET_MISMATCH", "The selected revision IDs must exactly identify the submitted selections.");
  }
  if (input.budget.designIntentId !== input.intent.designIntentId) {
    fail("M2_APPROVAL_SCOPE_MISMATCH", "The budget must belong to the submitted Design Intent.");
  }
  timestamp(input.budget.asOf, "M2_APPROVAL_INVALID_BUDGET_TIMESTAMP");
  const budget = chosenBudget(input.budget, input.chosenVariantId);
  if (!budget || budget.role !== variant.role) {
    fail("M2_APPROVAL_BUDGET_NOT_FOUND", "The chosen variant requires an exact budget.");
  }
  if (
    !Number.isSafeInteger(budget.amountRub) || budget.amountRub < 0
    || budget.missingPriceSelectionRevisionIds.length > 0
    || budget.staleSelectionRevisionIds.length > 0
    || !sameStrings(budget.pricedSelectionRevisionIds, input.selectionRevisionIds)
  ) fail("M2_APPROVAL_MISSING_PRICE", "Every chosen selection requires a current exact price.");

  const ids = sortedCodePoints(input.selectionRevisionIds);
  const selections = ids.map((id) => selectionsById.get(id)!);
  return immutable({
    submissionId: input.submissionId,
    status: "submitted",
    intent: input.intent,
    chosenVariantId: input.chosenVariantId,
    selectionRevisionIds: ids,
    selections,
    budget: input.budget,
    submittedBy: input.submittedBy,
    submittedAt: input.submittedAt,
    reason: input.reason,
    review: null,
  });
}

export function reviewM2ApprovalSubmission(
  input: ReviewM2ApprovalSubmissionInput,
): ReviewedM2ApprovalSubmission {
  human(input.reviewedBy);
  if (!(["approved", "rejected", "change_requested"] as readonly string[]).includes(input.decision)) {
    fail("M2_APPROVAL_INVALID_TRANSITION", "The requested review decision is invalid.");
  }
  if (input.submission.status !== "submitted" || input.submission.review !== null) {
    fail("M2_APPROVAL_INVALID_TRANSITION", "An M2 approval submission may be reviewed only once.");
  }
  if (input.reviewedBy.actorId === input.submission.submittedBy.actorId) {
    fail("M2_APPROVAL_REVIEWER_MUST_DIFFER", "The reviewer must differ from the submitter.");
  }
  nonEmpty(input.reason, "M2_APPROVAL_REVIEW_REASON_REQUIRED");
  const reviewedAt = timestamp(input.reviewedAt, "M2_APPROVAL_INVALID_TIMESTAMP");
  if (reviewedAt < timestamp(input.submission.submittedAt, "M2_APPROVAL_INVALID_TIMESTAMP")) {
    fail("M2_APPROVAL_REVIEW_BEFORE_SUBMISSION", "Review cannot precede submission.");
  }
  return immutable({
    ...input.submission,
    status: input.decision,
    review: {
      status: input.decision,
      reviewedBy: input.reviewedBy,
      reviewedAt: input.reviewedAt,
      reason: input.reason,
    },
  });
}

export function createApprovedM2Commit(
  input: CreateApprovedM2CommitInput,
): ApprovedM2Commit {
  const submission = input.approvedSubmission;
  if (submission.status !== "approved" || submission.review?.status !== "approved") {
    fail("M2_COMMIT_NOT_APPROVED", "Only an approved M2 submission can be committed.");
  }
  human(submission.submittedBy);
  human(submission.review.reviewedBy);
  if (submission.review.reviewedBy.actorId === submission.submittedBy.actorId) {
    fail("M2_APPROVAL_REVIEWER_MUST_DIFFER", "The reviewer must differ from the submitter.");
  }
  if (
    timestamp(submission.review.reviewedAt, "M2_APPROVAL_INVALID_TIMESTAMP")
    < timestamp(submission.submittedAt, "M2_APPROVAL_INVALID_TIMESTAMP")
  ) fail("M2_APPROVAL_REVIEW_BEFORE_SUBMISSION", "Review cannot precede submission.");
  const submittedIntent = submission.intent;
  if (
    input.currentIntent.designIntentId !== submittedIntent.designIntentId
    || input.currentIntent.projectId !== submittedIntent.projectId
    || input.currentIntent.packageId !== submittedIntent.packageId
    || input.currentIntent.roomId !== submittedIntent.roomId
    || input.currentIntent.revision.revisionId !== submittedIntent.revision.revisionId
    || input.currentIntent.revision.revisionNo !== submittedIntent.revision.revisionNo
  ) fail("M2_COMMIT_STALE_INTENT", "The submitted Design Intent revision is no longer current.");

  const submittedVariant = submittedIntent.variants.find((candidate) => candidate.variantId === submission.chosenVariantId);
  if (!submittedVariant) {
    fail("M2_APPROVAL_VARIANT_NOT_IN_INTENT", "The chosen variant is not in the submitted Design Intent.");
  }
  const currentVariant = input.currentIntent.variants.find((candidate) => candidate.variantId === submission.chosenVariantId);
  if (
    !currentVariant
    || currentVariant.projectId !== submittedVariant.projectId
    || currentVariant.packageId !== submittedVariant.packageId
    || currentVariant.roomId !== submittedVariant.roomId
    || currentVariant.role !== submittedVariant.role
    || currentVariant.layoutDocumentId !== submittedVariant.layoutDocumentId
    || currentVariant.layoutVersionId !== submittedVariant.layoutVersionId
    || currentVariant.semanticHash !== submittedVariant.semanticHash
  ) fail("M2_COMMIT_STALE_LAYOUT", "The chosen layout version has drifted since approval.");

  const currentByEntity = new Map(input.currentSelections.map((selection) => [selection.entityId, selection]));
  for (const approved of submission.selections) {
    const current = currentByEntity.get(approved.entityId);
    if (
      !current
      || current.id !== approved.id
      || current.revisionNo !== approved.revisionNo
      || !structurallyEqual(current, approved)
    ) {
      fail("M2_COMMIT_STALE_SELECTION", "An approved selection revision is no longer current.");
    }
  }
  if (input.currentSelections.length !== submission.selections.length) {
    fail("M2_COMMIT_STALE_SELECTION", "The current selection set differs from the approved set.");
  }

  const approvedBudget = chosenBudget(submission.budget, submission.chosenVariantId)!;
  const recalculated = chosenBudget(input.recalculatedBudget, submission.chosenVariantId);
  if (
    input.recalculatedBudget.designIntentId !== submission.budget.designIntentId
    || input.recalculatedBudget.asOf !== submission.budget.asOf
    || input.recalculatedBudget.staleAfterDays !== submission.budget.staleAfterDays
    || !recalculated
    || recalculated.role !== approvedBudget.role
    || recalculated.amountRub !== approvedBudget.amountRub
    || !sameStrings(recalculated.pricedSelectionRevisionIds, approvedBudget.pricedSelectionRevisionIds)
    || !sameStrings(recalculated.staleSelectionRevisionIds, approvedBudget.staleSelectionRevisionIds)
    || !sameStrings(recalculated.missingPriceSelectionRevisionIds, approvedBudget.missingPriceSelectionRevisionIds)
  ) fail("M2_COMMIT_STALE_BUDGET", "The chosen variant budget has drifted since approval.");

  const selections = [...submission.selections].sort((left, right) => compareCodePoints(left.id, right.id));
  return immutable({
    projectId: submittedIntent.projectId,
    packageId: submittedIntent.packageId,
    roomId: submittedIntent.roomId,
    designIntentRevisionId: submittedIntent.revision.revisionId,
    chosenVariant: submittedVariant,
    approvedSelectionRevisionIds: sortedCodePoints(submission.selectionRevisionIds),
    selections,
    budget: {
      asOf: submission.budget.asOf,
      staleAfterDays: submission.budget.staleAfterDays,
      variantId: approvedBudget.variantId,
      amountRub: approvedBudget.amountRub,
      staleSelectionRevisionIds: sortedCodePoints(approvedBudget.staleSelectionRevisionIds),
      missingPriceSelectionRevisionIds: sortedCodePoints(approvedBudget.missingPriceSelectionRevisionIds),
    },
    submittedBy: submission.submittedBy,
    reviewedBy: submission.review.reviewedBy,
    submittedAt: submission.submittedAt,
    reviewedAt: submission.review.reviewedAt,
    submissionReason: submission.reason,
    reviewReason: submission.review.reason,
  });
}
