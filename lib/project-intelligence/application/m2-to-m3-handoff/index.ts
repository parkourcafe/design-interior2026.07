export const M2_TO_M3_HANDOFF_CONTRACT_VERSION = "archidom.m2-to-m3-handoff/0.1" as const;

type VariantRole = "preferred" | "value_engineered" | "premium";
type CommitStatus = "draft" | "submitted" | "approved" | "rejected" | "change_requested";

export interface M2ApprovedCommitInput {
  readonly id: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly status: CommitStatus;
  readonly payload: {
    readonly approvalPackageId: string;
    readonly roomId: string;
    readonly designIntentRevisionId: string;
    readonly chosenVariant: {
      readonly variantId: string;
      readonly role: VariantRole;
      readonly layoutDocumentId: string;
      readonly layoutVersionId: string;
      readonly layoutRevisionId: string;
      readonly semanticHash: string;
    };
    readonly approvedSelectionRevisionIds: readonly string[];
    readonly budget: {
      readonly asOf: string;
      readonly staleAfterDays: number;
      readonly amountRub: number;
      readonly staleSelectionRevisionIds: readonly string[];
      readonly missingPriceSelectionRevisionIds: readonly string[];
    };
    readonly submittedAt: string;
    readonly reviewedAt: string;
    readonly submissionReason: string;
    readonly reviewReason: string;
  };
  readonly createdAt: string;
}

export interface M2LayoutVersionInput {
  readonly projectId: string;
  readonly packageId: string;
  readonly documentId: string;
  readonly versionId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly status: string;
  readonly semanticHash: string;
  readonly roomId: string;
  readonly variantId: string;
  readonly role: VariantRole;
}

export interface M2SelectionRevisionInput {
  readonly projectId: string;
  readonly packageId: string;
  readonly entityId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly status: string;
}

export interface CreateM2ToM3HandoffInput {
  readonly projectId: string;
  readonly packageId: string;
  readonly approvedCommit: M2ApprovedCommitInput;
  readonly layoutVersions: readonly M2LayoutVersionInput[];
  readonly selections: readonly M2SelectionRevisionInput[];
}

export interface M2ToM3Handoff {
  readonly contractVersion: typeof M2_TO_M3_HANDOFF_CONTRACT_VERSION;
  readonly projectId: string;
  readonly packageId: string;
  readonly roomId: string;
  readonly approvedM2CommitId: string;
  readonly approvedM2CommitRevisionId: string;
  readonly designIntentRevisionId: string;
  readonly layout: {
    readonly documentId: string;
    readonly versionId: string;
    readonly revisionId: string;
    readonly semanticHash: string;
  };
  readonly selectionRevisionIds: readonly string[];
  readonly approvedAt: string;
}

export class M2ToM3HandoffError extends Error {
  constructor(public readonly code: string, message = code) {
    super(message);
    this.name = "M2ToM3HandoffError";
  }
}

function fail(code: string): never {
  throw new M2ToM3HandoffError(code);
}

function immutable<T>(value: T): T {
  const copy = structuredClone(value);
  const freeze = (candidate: unknown): void => {
    if (candidate === null || typeof candidate !== "object" || Object.isFrozen(candidate)) return;
    for (const child of Object.values(candidate as Record<string, unknown>)) freeze(child);
    Object.freeze(candidate);
  };
  freeze(copy);
  return copy;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const OFFSET_TIMESTAMP = /(?:Z|[+-]\d{2}:\d{2})$/;

function validTimestamp(value: string): boolean {
  return OFFSET_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function identifier(value: string): boolean {
  return value.length >= 1 && value.length <= 160 && value === value.trim();
}

function reason(value: string): boolean {
  return value.length >= 3 && value.length <= 4000 && value === value.trim();
}

function compareCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function validateTrustBoundary(input: CreateM2ToM3HandoffInput): void {
  const { approvedCommit: commit } = input;
  const { chosenVariant: chosen, budget } = commit.payload;
  if (
    !UUID.test(input.projectId)
    || !UUID.test(input.packageId)
    || !UUID.test(commit.projectId)
    || !UUID.test(commit.revisionId)
    || !Number.isSafeInteger(commit.revisionNo)
    || commit.revisionNo < 1
    || !UUID.test(chosen.layoutRevisionId)
    || !HASH.test(chosen.semanticHash)
    || !identifier(commit.id)
    || !identifier(commit.payload.approvalPackageId)
    || !identifier(commit.payload.roomId)
    || !identifier(commit.payload.designIntentRevisionId)
    || !identifier(chosen.variantId)
    || !identifier(chosen.layoutDocumentId)
    || !identifier(chosen.layoutVersionId)
    || !(chosen.role === "preferred" || chosen.role === "value_engineered" || chosen.role === "premium")
    || !reason(commit.payload.submissionReason)
    || !reason(commit.payload.reviewReason)
    || !validTimestamp(commit.payload.submittedAt)
    || !validTimestamp(commit.payload.reviewedAt)
    || Date.parse(commit.payload.reviewedAt) < Date.parse(commit.payload.submittedAt)
    || !validTimestamp(budget.asOf)
    || !Number.isSafeInteger(budget.staleAfterDays)
    || budget.staleAfterDays < 1
    || !Number.isSafeInteger(budget.amountRub)
    || budget.amountRub < 0
    || input.layoutVersions.some((layout) => (
      !UUID.test(layout.projectId)
      || !UUID.test(layout.packageId)
      || !UUID.test(layout.revisionId)
      || !Number.isSafeInteger(layout.revisionNo)
      || layout.revisionNo < 1
      || !HASH.test(layout.semanticHash)
    ))
    || input.selections.some((selection) => (
      !UUID.test(selection.projectId)
      || !UUID.test(selection.packageId)
      || !Number.isSafeInteger(selection.revisionNo)
      || selection.revisionNo < 1
    ))
  ) fail("M2_M3_INVALID_INPUT");
}

export function createM2ToM3Handoff(input: CreateM2ToM3HandoffInput): M2ToM3Handoff {
  validateTrustBoundary(input);
  const commit = input.approvedCommit;
  if (commit.status !== "approved") fail("M2_M3_COMMIT_NOT_APPROVED");
  if (commit.projectId !== input.projectId || commit.packageId !== input.packageId) {
    fail("M2_M3_SCOPE_MISMATCH");
  }
  if (
    input.layoutVersions.some((layout) => (
      layout.projectId !== input.projectId || layout.packageId !== input.packageId
    ))
    || input.selections.some((selection) => (
      selection.projectId !== input.projectId || selection.packageId !== input.packageId
    ))
  ) fail("M2_M3_SCOPE_MISMATCH");

  const layoutKeys = input.layoutVersions.map((layout) => layout.revisionId);
  if (new Set(layoutKeys).size !== layoutKeys.length) fail("M2_M3_DUPLICATE_LAYOUT_CANDIDATE");
  const selectionKeys = input.selections.map((selection) => selection.revisionId);
  if (new Set(selectionKeys).size !== selectionKeys.length) fail("M2_M3_DUPLICATE_SELECTION_CANDIDATE");

  if (commit.payload.approvedSelectionRevisionIds.length === 0) fail("M2_M3_SELECTIONS_EMPTY");
  if (
    commit.payload.budget.staleSelectionRevisionIds.length > 0
    || commit.payload.budget.missingPriceSelectionRevisionIds.length > 0
  ) fail("M2_M3_BUDGET_NOT_CLEAN");

  const chosen = commit.payload.chosenVariant;
  const layout = input.layoutVersions.find((candidate) => (
    candidate.documentId === chosen.layoutDocumentId
    && candidate.versionId === chosen.layoutVersionId
    && candidate.revisionId === chosen.layoutRevisionId
    && candidate.status === "published"
  ));
  if (!layout) fail("M2_M3_EXACT_LAYOUT_NOT_FOUND");
  if (
    layout.semanticHash !== chosen.semanticHash
    || layout.roomId !== commit.payload.roomId
    || layout.variantId !== chosen.variantId
    || layout.role !== chosen.role
  ) fail("M2_M3_LAYOUT_MISMATCH");

  const selectionIds = commit.payload.approvedSelectionRevisionIds;
  if (new Set(selectionIds).size !== selectionIds.length) fail("M2_M3_EXACT_SELECTION_NOT_FOUND");
  for (const revisionId of selectionIds) {
    const selection = input.selections.find((candidate) => candidate.revisionId === revisionId);
    if (!selection) fail("M2_M3_EXACT_SELECTION_NOT_FOUND");
    if (selection.status !== "approved") fail("M2_M3_EXACT_SELECTION_NOT_APPROVED");
  }

  return immutable({
    contractVersion: M2_TO_M3_HANDOFF_CONTRACT_VERSION,
    projectId: input.projectId,
    packageId: input.packageId,
    roomId: commit.payload.roomId,
    approvedM2CommitId: commit.id,
    approvedM2CommitRevisionId: commit.revisionId,
    designIntentRevisionId: commit.payload.designIntentRevisionId,
    layout: {
      documentId: layout.documentId,
      versionId: layout.versionId,
      revisionId: layout.revisionId,
      semanticHash: layout.semanticHash,
    },
    selectionRevisionIds: [...selectionIds].sort(compareCodePoints),
    approvedAt: commit.payload.reviewedAt,
  });
}
