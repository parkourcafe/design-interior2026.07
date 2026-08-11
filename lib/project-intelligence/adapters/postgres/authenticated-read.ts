import type { PostgresRpcClient } from "./contracts";
import type { ExecutionDeliveryEnvelope } from "./execution";
import { callRpc } from "./rpc";

export const AUTHENTICATED_READ_CONTRACT_VERSION =
  "project-ceo-authenticated-read/0.1" as const;

export interface AuthenticatedReadEvidence {
  readonly evidenceLinkId: string;
  readonly evidenceVersionId: string;
  readonly fragmentId: string;
  readonly locator: Readonly<Record<string, unknown>>;
  readonly locatorKind: string;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
}

export interface AuthenticatedReadRevisionHistory {
  readonly reason: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly status: "current" | "superseded";
}

export interface AuthenticatedReadDecision {
  readonly areaNodeId: string | null;
  readonly claimStatus: "extracted" | "interpreted" | "unknown" | "human_origin";
  readonly evidence: readonly AuthenticatedReadEvidence[];
  readonly id: string;
  readonly packageId: string;
  readonly resolution: string;
  readonly revisionHistory: readonly AuthenticatedReadRevisionHistory[];
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly reviewStatus: "submitted" | "approved" | "change_requested";
  readonly title: string;
}

export interface AuthenticatedReadSelection {
  readonly area: string;
  readonly areaNodeId: string;
  readonly claimStatus: "extracted" | "interpreted" | "unknown" | "human_origin";
  readonly decisionRevisionId: string;
  readonly evidence: readonly AuthenticatedReadEvidence[];
  readonly id: string;
  readonly packageId: string;
  readonly priceObservation: {
    readonly amountRub: number;
    readonly checkedAt: string;
    readonly sourceId: string;
    readonly sourceRevisionId: string;
  } | null;
  readonly revisionHistory: readonly AuthenticatedReadRevisionHistory[];
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly reviewStatus: "draft" | "submitted" | "approved" | "rejected" | "change_requested";
  readonly specification: Readonly<Record<string, unknown>>;
  readonly title: string;
}

export interface AuthenticatedReadSource {
  readonly availability: "materialized" | "placeholder";
  readonly checksum: string | null;
  readonly disciplineKey: string;
  readonly documentStatus: "current" | "previous" | "reference" | "unknown";
  readonly floorKey: string;
  readonly id: string;
  readonly kind: string | null;
  readonly logicalSourceId: string | null;
  readonly mediaType: string | null;
  readonly packageId: string;
  readonly reviewStatus: "pending" | "confirmed" | "rejected";
  readonly reviewTargetRevisionId: string | null;
  readonly sanitizedName: string;
  readonly semanticConflict: boolean;
  readonly sizeBytes: number | null;
  readonly sourceRevisionId: string | null;
  readonly sourceRole: string | null;
  readonly zoneKey: string;
}

export interface AuthenticatedReadSourceStats {
  readonly duplicateGroups: number;
  readonly materializedRecords: number;
  readonly physicalRecords: number;
  readonly placeholders: number;
  readonly quarantinedGroups: number;
  readonly reviewQueue: number;
  readonly uniqueBlobs: number;
}

export interface AuthenticatedReadDistributionSummary {
  readonly acknowledgementCount: number;
  readonly packageId: string;
  readonly productionPackageVersionId: string;
  readonly recipientCount: number;
}

export interface AuthenticatedReadRecipientDistribution {
  readonly acknowledged: boolean;
  readonly acknowledgedAt: string | null;
  readonly artifactId: string;
  readonly distributedAt: string;
  readonly distributionId: string;
  readonly packageId: string;
  readonly productionPackageVersionId: string;
  readonly semanticHash: `sha256:${string}`;
}

export interface AuthenticatedReadReleaseRecipient {
  readonly packageId: string | null;
  readonly role: "owner_lead" | "architect" | "builder" | "client_approver";
  readonly scope: "project" | "package";
  readonly userId: string;
}

export interface AuthenticatedReadM2ApprovedCommitPayload {
  readonly approvalPackageId: string;
  readonly approvedSelectionRevisionIds: readonly string[];
  readonly budget: {
    readonly amountRub?: number;
    readonly asOf: string;
    readonly missingPriceSelectionRevisionIds: readonly [];
    readonly staleAfterDays: number;
    readonly staleSelectionRevisionIds: readonly [];
  };
  readonly chosenVariant: {
    readonly layoutDocumentId: string;
    readonly layoutVersionId: string;
    readonly layoutRevisionId?: string;
    readonly role: "preferred" | "value_engineered" | "premium";
    readonly semanticHash: `sha256:${string}`;
    readonly variantId: string;
  };
  readonly designIntentRevisionId: string;
  readonly reviewedAt: string;
  readonly reviewReason: string;
  readonly roomId: string;
  readonly submittedAt: string;
  readonly submissionReason: string;
  readonly clientSubmissionId?: string;
  readonly clientReviewRevisionId?: string;
}

export interface AuthenticatedReadM2ApprovedCommit {
  readonly createdAt: string;
  readonly id: string;
  readonly packageId: string;
  readonly payload: AuthenticatedReadM2ApprovedCommitPayload;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly status: "approved";
}

export interface AuthenticatedReadM2LayoutVersionPayload {
  /** Omitted by the read projection for builder sessions. */
  readonly layoutContent?: Readonly<Record<string, unknown>>;
  readonly role: "preferred" | "value_engineered" | "premium";
  readonly roomId: string;
  readonly schemaVersion: "project-ceo-m2-layout/0.1";
  readonly semanticHash: `sha256:${string}`;
  readonly variantId: string;
  readonly versionId: string;
}

export interface AuthenticatedReadM2LayoutVersion {
  readonly createdAt: string;
  readonly documentId: string;
  readonly id: string;
  readonly packageId: string;
  readonly payload: AuthenticatedReadM2LayoutVersionPayload;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly role: "preferred" | "value_engineered" | "premium";
  readonly roomId: string;
  readonly schemaVersion: "project-ceo-m2-layout/0.1";
  readonly semanticHash: `sha256:${string}`;
  readonly status: "published";
  readonly variantId: string;
  readonly versionId: string;
}

export interface AuthenticatedReadM2ClientReviewSubmission {
  readonly id: string; readonly packageId: string; readonly revisionId: string; readonly revisionNo: number;
  readonly status: "submitted"; readonly assignedClientUserId: string; readonly createdAt: string;
  readonly payload: {
    readonly approvalPackageId: string; readonly roomId: string; readonly designIntentRevisionId: string;
    readonly budgetAsOf: string; readonly staleAfterDays: number; readonly submittedByActorUserId: string;
    readonly submissionReason: string; readonly submittedAt: string;
    readonly variants: readonly {
      readonly variantId: string; readonly role: "preferred" | "value_engineered" | "premium";
      readonly layoutDocumentId: string; readonly layoutVersionId: string; readonly layoutRevisionId: string;
      readonly semanticHash: `sha256:${string}`; readonly selectionRevisionIds: readonly string[];
      readonly budget: { readonly amountRub: number; readonly staleSelectionRevisionIds: readonly string[]; readonly missingPriceSelectionRevisionIds: readonly string[] };
    }[];
  };
}

export interface AuthenticatedReadM2M3Handoff {
  readonly id: string; readonly packageId: string; readonly revisionId: string; readonly revisionNo: number;
  readonly status: "published"; readonly approvedCommitId: string; readonly approvedCommitRevisionId: string;
  readonly layoutRevisionId: string; readonly selectionRevisionIds: readonly string[];
  readonly budget: AuthenticatedReadM2ApprovedCommitPayload["budget"]; readonly createdAt: string;
}

/**
 * Лист пакета документации M3 в проекции v7: последняя ревизия листа и её
 * происхождение. Поле необязательно — проекции более ранних контрактов его не
 * несут, и код обязан переживать это, а не падать.
 */
export interface AuthenticatedReadDocumentationSheet {
  readonly sheetId: string;
  readonly packageId: string;
  readonly roomId: string;
  readonly sheetNumber: string;
  readonly title: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly specificationRevisionIds: readonly string[];
  readonly reason: string;
  readonly createdByUserId: string;
  readonly origin: {
    readonly handoffId: string;
    readonly handoffRevisionId: string;
    readonly handoffContractVersion: string;
    readonly approvedM2CommitRevisionId: string;
    readonly designIntentRevisionId: string;
    readonly layoutDocumentId: string;
    readonly layoutVersionId: string;
    readonly layoutRevisionId: string;
    readonly semanticHash: string;
  };
  readonly createdAt: string;
}

/**
 * Вход модуля документации в его собственной форме — то же утверждённое
 * решение M2, что несёт m2M3Handoffs, но с комнатой и design intent, без
 * которых проверку комплектности не на чем запускать.
 */
export interface AuthenticatedReadDocumentationHandoff {
  readonly handoffId: string;
  readonly revisionId: string;
  readonly contractVersion: string;
  readonly packageId: string;
  readonly roomId: string;
  readonly approvedM2CommitRevisionId: string;
  readonly designIntentRevisionId: string;
  readonly layout: {
    readonly documentId: string;
    readonly versionId: string;
    readonly revisionId: string;
    readonly semanticHash: string;
  };
  readonly selectionRevisionIds: readonly string[];
}

export interface AuthenticatedProjectReadProjection {
  readonly approvalPackages: readonly Readonly<Record<string, unknown>>[];
  readonly m2Rooms?: readonly Readonly<Record<string, unknown>>[];
  readonly m2Variants?: readonly Readonly<Record<string, unknown>>[];
  readonly m2Materials?: readonly Readonly<Record<string, unknown>>[];
  readonly m2BudgetFrames?: readonly Readonly<Record<string, unknown>>[];
  readonly m2ClientHandoffs?: readonly Readonly<Record<string, unknown>>[];
  readonly m2ApprovedCommits: readonly AuthenticatedReadM2ApprovedCommit[];
  readonly m2LayoutVersions: readonly AuthenticatedReadM2LayoutVersion[];
  readonly m2ClientReviewSubmissions: readonly AuthenticatedReadM2ClientReviewSubmission[];
  readonly m2ClientReviews: readonly Readonly<Record<string, unknown>>[];
  readonly m2M3Handoffs: readonly AuthenticatedReadM2M3Handoff[];
  readonly m3DocumentationSheets?: readonly AuthenticatedReadDocumentationSheet[];
  readonly m3DocumentationHandoffs?: readonly AuthenticatedReadDocumentationHandoff[];
  readonly decisions: readonly AuthenticatedReadDecision[];
  readonly distributionSummary: readonly AuthenticatedReadDistributionSummary[];
  readonly executionPackages: readonly ExecutionDeliveryEnvelope[];
  readonly extensionStatus: Readonly<Record<string, string>>;
  readonly latestBaseline: Readonly<Record<string, unknown>> | null;
  readonly noChangeTerminals: readonly Readonly<Record<string, unknown>>[];
  readonly packages: readonly Readonly<Record<string, unknown>>[];
  readonly packageVersions: readonly Readonly<Record<string, unknown>>[];
  readonly projectMetadata: {
    readonly areaM2: number;
    readonly location: string;
    readonly model: "full_project";
    readonly name: string;
  };
  readonly recipientDistributions: readonly AuthenticatedReadRecipientDistribution[];
  readonly releaseArtifacts: readonly Readonly<Record<string, unknown>>[];
  readonly releaseRecipients: readonly AuthenticatedReadReleaseRecipient[];
  readonly reviewQueue: readonly Readonly<Record<string, unknown>>[];
  readonly selections: readonly AuthenticatedReadSelection[];
  readonly sourceStats: AuthenticatedReadSourceStats;
  readonly sources: readonly AuthenticatedReadSource[];
  readonly unresolvedImpactReviewCount: number;
}

export interface AuthenticatedProjectReadEnvelope {
  readonly contractVersion: typeof AUTHENTICATED_READ_CONTRACT_VERSION;
  readonly requestId: string;
  readonly data: AuthenticatedProjectReadProjection;
  readonly error: null;
  readonly scope: {
    readonly accessScope: "project" | "package";
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly packageId: string | null;
    readonly projectId: string;
  };
  readonly stateRevision: number;
}

export interface AuthenticatedProjectReadControlledError {
  readonly contractVersion: typeof AUTHENTICATED_READ_CONTRACT_VERSION;
  readonly requestId: string;
  readonly data: null;
  readonly error:
    | { readonly code: "forbidden"; readonly messageKey: "projectceo.read.forbidden" }
    | { readonly code: "not_found"; readonly messageKey: "projectceo.read.not_found" }
    | {
      readonly code: "validation_failed";
      readonly messageKey: "projectceo.read.validation_failed";
    };
  readonly scope: null;
  readonly stateRevision: null;
}

export type AuthenticatedProjectReadResult =
  | AuthenticatedProjectReadEnvelope
  | AuthenticatedProjectReadControlledError;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 160
    && value === value.trim();
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function isRevisionNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isReason(value: unknown): value is string {
  return typeof value === "string"
    && value.length >= 3
    && value.length <= 4000
    && value === value.trim();
}

function isEmptyArray(value: unknown): value is readonly [] {
  return Array.isArray(value) && value.length === 0;
}

function isApprovedCommitBudget(
  value: unknown,
): value is AuthenticatedReadM2ApprovedCommitPayload["budget"] {
  if (!isRecord(value)) return false;
  const requiredKeys = [
    "asOf",
    "staleAfterDays",
    "staleSelectionRevisionIds",
    "missingPriceSelectionRevisionIds",
  ] as const;
  const allowedKeys = [...requiredKeys, "amountRub"];
  if (!requiredKeys.every((key) => Object.hasOwn(value, key))) return false;
  if (!Object.keys(value).every((key) => allowedKeys.includes(key as typeof allowedKeys[number]))) {
    return false;
  }
  return isTimestamp(value.asOf)
    && typeof value.staleAfterDays === "number"
    && Number.isSafeInteger(value.staleAfterDays)
    && value.staleAfterDays > 0
    && (!Object.hasOwn(value, "amountRub") || (
      typeof value.amountRub === "number"
      && Number.isSafeInteger(value.amountRub)
      && value.amountRub >= 0
    ))
    && isEmptyArray(value.staleSelectionRevisionIds)
    && isEmptyArray(value.missingPriceSelectionRevisionIds);
}

function isApprovedCommitChosenVariant(
  value: unknown,
): value is AuthenticatedReadM2ApprovedCommitPayload["chosenVariant"] {
  if (!isRecord(value)) return false;
  const keys = [
    "variantId",
    "role",
    "layoutDocumentId",
    "layoutVersionId",
    "semanticHash",
  ];
  const isClientReviewed = Object.hasOwn(value, "layoutRevisionId");
  if (!hasExactKeys(value, isClientReviewed ? [...keys, "layoutRevisionId"] : keys)) {
    return false;
  }
  return isIdentifier(value.variantId)
    && (value.role === "preferred" || value.role === "value_engineered" || value.role === "premium")
    && isIdentifier(value.layoutDocumentId)
    && isIdentifier(value.layoutVersionId)
    && (!isClientReviewed || isUuid(value.layoutRevisionId))
    && typeof value.semanticHash === "string"
    && /^sha256:[0-9a-f]{64}$/.test(value.semanticHash);
}

function isApprovedCommitPayload(value: unknown): value is AuthenticatedReadM2ApprovedCommitPayload {
  if (!isRecord(value)) return false;
  const keys = [
    "approvalPackageId",
    "roomId",
    "designIntentRevisionId",
    "chosenVariant",
    "approvedSelectionRevisionIds",
    "budget",
    "submittedAt",
    "reviewedAt",
    "submissionReason",
    "reviewReason",
  ];
  const isClientReviewed = Object.hasOwn(value, "clientSubmissionId")
    || Object.hasOwn(value, "clientReviewRevisionId");
  if (!hasExactKeys(value, isClientReviewed
    ? [...keys, "clientSubmissionId", "clientReviewRevisionId"]
    : keys)) {
    return false;
  }
  if (!Array.isArray(value.approvedSelectionRevisionIds)
    || value.approvedSelectionRevisionIds.length < 1
    || value.approvedSelectionRevisionIds.length > 500
    || !value.approvedSelectionRevisionIds.every(isIdentifier)
    || new Set(value.approvedSelectionRevisionIds).size !== value.approvedSelectionRevisionIds.length
  ) {
    return false;
  }
  return isIdentifier(value.approvalPackageId)
    && isIdentifier(value.roomId)
    && isIdentifier(value.designIntentRevisionId)
    && isApprovedCommitChosenVariant(value.chosenVariant)
    && isApprovedCommitBudget(value.budget)
    && (!isClientReviewed || (
      isIdentifier(value.clientSubmissionId)
      && isUuid(value.clientReviewRevisionId)
    ))
    && isTimestamp(value.submittedAt)
    && isTimestamp(value.reviewedAt)
    && Date.parse(value.reviewedAt) >= Date.parse(value.submittedAt)
    && isReason(value.submissionReason)
    && isReason(value.reviewReason);
}

function isApprovedCommit(value: unknown): value is AuthenticatedReadM2ApprovedCommit {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id",
    "packageId",
    "revisionId",
    "revisionNo",
    "status",
    "payload",
    "createdAt",
  ])) {
    return false;
  }
  return isIdentifier(value.id)
    && isUuid(value.packageId)
    && isUuid(value.revisionId)
    && isRevisionNumber(value.revisionNo)
    && value.status === "approved"
    && isApprovedCommitPayload(value.payload)
    && isTimestamp(value.createdAt);
}

function isLayoutVersionPayload(value: unknown): value is AuthenticatedReadM2LayoutVersionPayload {
  if (!isRecord(value)) return false;
  const requiredKeys = [
    "versionId",
    "roomId",
    "variantId",
    "role",
    "semanticHash",
    "schemaVersion",
  ] as const;
  const allowedKeys = [...requiredKeys, "layoutContent"];
  if (!requiredKeys.every((key) => Object.hasOwn(value, key))) return false;
  if (!Object.keys(value).every((key) => allowedKeys.includes(key as typeof allowedKeys[number]))) {
    return false;
  }
  return isIdentifier(value.versionId)
    && isIdentifier(value.roomId)
    && isIdentifier(value.variantId)
    && (value.role === "preferred" || value.role === "value_engineered" || value.role === "premium")
    && typeof value.semanticHash === "string"
    && /^sha256:[0-9a-f]{64}$/.test(value.semanticHash)
    && value.schemaVersion === "project-ceo-m2-layout/0.1"
    && (!Object.hasOwn(value, "layoutContent") || isRecord(value.layoutContent));
}

function isLayoutVersion(value: unknown): value is AuthenticatedReadM2LayoutVersion {
  if (!isRecord(value) || !hasExactKeys(value, [
    "id",
    "documentId",
    "versionId",
    "packageId",
    "revisionId",
    "revisionNo",
    "semanticHash",
    "roomId",
    "variantId",
    "role",
    "schemaVersion",
    "status",
    "payload",
    "createdAt",
  ])) {
    return false;
  }
  if (!isLayoutVersionPayload(value.payload)) return false;
  return isIdentifier(value.id)
    && value.documentId === value.id
    && value.versionId === value.payload.versionId
    && isUuid(value.packageId)
    && isUuid(value.revisionId)
    && isRevisionNumber(value.revisionNo)
    && value.semanticHash === value.payload.semanticHash
    && value.roomId === value.payload.roomId
    && value.variantId === value.payload.variantId
    && value.role === value.payload.role
    && value.schemaVersion === value.payload.schemaVersion
    && value.status === "published"
    && isTimestamp(value.createdAt);
}

function isM2ClientReviewSubmission(value: unknown): value is AuthenticatedReadM2ClientReviewSubmission {
  if (!isRecord(value) || !isRecord(value.payload)) return false;
  const payload = value.payload;
  if (!hasExactKeys(payload, ["approvalPackageId", "roomId", "designIntentRevisionId", "variants", "budgetAsOf", "staleAfterDays", "submittedByActorUserId", "submissionReason", "submittedAt"])
    || !isIdentifier(payload.approvalPackageId) || !isIdentifier(payload.roomId) || !isIdentifier(payload.designIntentRevisionId)
    || !isTimestamp(payload.budgetAsOf) || !isRevisionNumber(payload.staleAfterDays)
    || !isUuid(payload.submittedByActorUserId) || !isReason(payload.submissionReason) || !isTimestamp(payload.submittedAt)
    || !Array.isArray(payload.variants) || payload.variants.length !== 3) return false;
  const roles = new Set<string>();
  const variantIds = new Set<string>();
  const layoutRevisionIds = new Set<string>();
  for (const candidate of payload.variants) {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ["variantId", "role", "layoutDocumentId", "layoutVersionId", "layoutRevisionId", "semanticHash", "selectionRevisionIds", "budget"])
      || !isIdentifier(candidate.variantId) || !isIdentifier(candidate.layoutDocumentId) || !isIdentifier(candidate.layoutVersionId)
      || !isUuid(candidate.layoutRevisionId) || typeof candidate.semanticHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(candidate.semanticHash)
      || (candidate.role !== "preferred" && candidate.role !== "value_engineered" && candidate.role !== "premium")
      || !Array.isArray(candidate.selectionRevisionIds) || candidate.selectionRevisionIds.length < 1
      || !candidate.selectionRevisionIds.every(isIdentifier) || new Set(candidate.selectionRevisionIds).size !== candidate.selectionRevisionIds.length
      || !isRecord(candidate.budget) || !hasExactKeys(candidate.budget, ["amountRub", "staleSelectionRevisionIds", "missingPriceSelectionRevisionIds"])
      || typeof candidate.budget.amountRub !== "number" || !Number.isSafeInteger(candidate.budget.amountRub) || candidate.budget.amountRub < 0
      || !Array.isArray(candidate.budget.staleSelectionRevisionIds) || !candidate.budget.staleSelectionRevisionIds.every(isIdentifier)
      || !Array.isArray(candidate.budget.missingPriceSelectionRevisionIds) || !candidate.budget.missingPriceSelectionRevisionIds.every(isIdentifier)) return false;
    const staleIds = candidate.budget.staleSelectionRevisionIds as readonly string[];
    const missingIds = candidate.budget.missingPriceSelectionRevisionIds as readonly string[];
    const selectionIds = candidate.selectionRevisionIds as readonly string[];
    if (new Set(staleIds).size !== staleIds.length || new Set(missingIds).size !== missingIds.length
      || !staleIds.every((id) => selectionIds.includes(id))
      || !missingIds.every((id) => selectionIds.includes(id))) return false;
    roles.add(candidate.role);
    variantIds.add(candidate.variantId as string);
    layoutRevisionIds.add(candidate.layoutRevisionId as string);
  }
  if (roles.size !== 3 || variantIds.size !== 3 || layoutRevisionIds.size !== 3) return false;
  return isRecord(value)
    && hasExactKeys(value, [
      "id", "packageId", "revisionId", "revisionNo", "status",
      "assignedClientUserId", "payload", "createdAt",
    ])
    && isIdentifier(value.id)
    && isUuid(value.packageId)
    && isUuid(value.revisionId)
    && isRevisionNumber(value.revisionNo)
    && value.status === "submitted"
    && isUuid(value.assignedClientUserId)
    && isRecord(value.payload)
    && isTimestamp(value.createdAt);
}

function isM2ClientReview(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      "id", "packageId", "revisionId", "revisionNo", "status",
      "submissionId", "chosenVariantId", "createdAt",
    ])
    && isIdentifier(value.id)
    && isUuid(value.packageId)
    && isUuid(value.revisionId)
    && isRevisionNumber(value.revisionNo)
    && (value.status === "approved" || value.status === "rejected" || value.status === "change_requested")
    && isIdentifier(value.submissionId)
    && isIdentifier(value.chosenVariantId)
    && isTimestamp(value.createdAt);
}

function isDocumentationSheetOrigin(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, [
      "handoffId", "handoffRevisionId", "handoffContractVersion",
      "approvedM2CommitRevisionId", "designIntentRevisionId",
      "layoutDocumentId", "layoutVersionId", "layoutRevisionId", "semanticHash",
    ])
    && isIdentifier(value.handoffId)
    && isIdentifier(value.handoffRevisionId)
    && isIdentifier(value.handoffContractVersion)
    && isIdentifier(value.approvedM2CommitRevisionId)
    && isIdentifier(value.designIntentRevisionId)
    && isIdentifier(value.layoutDocumentId)
    && isIdentifier(value.layoutVersionId)
    && isIdentifier(value.layoutRevisionId)
    && typeof value.semanticHash === "string"
    && /^sha256:[0-9a-f]{64}$/.test(value.semanticHash);
}

function isDocumentationSheet(value: unknown): value is AuthenticatedReadDocumentationSheet {
  return isRecord(value)
    && hasExactKeys(value, [
      "sheetId", "packageId", "roomId", "sheetNumber", "title",
      "revisionId", "revisionNo", "specificationRevisionIds",
      "reason", "createdByUserId", "origin", "createdAt",
    ])
    && isIdentifier(value.sheetId)
    && isUuid(value.packageId)
    && isIdentifier(value.roomId)
    && isIdentifier(value.sheetNumber)
    && typeof value.title === "string" && value.title.length > 0
    && isIdentifier(value.revisionId)
    && isRevisionNumber(value.revisionNo)
    && Array.isArray(value.specificationRevisionIds)
    && value.specificationRevisionIds.every(isIdentifier)
    && typeof value.reason === "string"
    && isUuid(value.createdByUserId)
    && isDocumentationSheetOrigin(value.origin)
    && isTimestamp(value.createdAt);
}

function isDocumentationHandoff(value: unknown): value is AuthenticatedReadDocumentationHandoff {
  return isRecord(value)
    && hasExactKeys(value, [
      "handoffId", "revisionId", "contractVersion", "packageId", "roomId",
      "approvedM2CommitRevisionId", "designIntentRevisionId", "layout",
      "selectionRevisionIds",
    ])
    && isIdentifier(value.handoffId)
    && isIdentifier(value.revisionId)
    && isIdentifier(value.contractVersion)
    && isUuid(value.packageId)
    && isIdentifier(value.roomId)
    && isIdentifier(value.approvedM2CommitRevisionId)
    && isIdentifier(value.designIntentRevisionId)
    && isRecord(value.layout)
    && hasExactKeys(value.layout, ["documentId", "versionId", "revisionId", "semanticHash"])
    && isIdentifier(value.layout.documentId)
    && isIdentifier(value.layout.versionId)
    && isIdentifier(value.layout.revisionId)
    && typeof value.layout.semanticHash === "string"
    && /^sha256:[0-9a-f]{64}$/.test(value.layout.semanticHash)
    && Array.isArray(value.selectionRevisionIds)
    && value.selectionRevisionIds.every(isIdentifier);
}

function isM2M3Handoff(value: unknown): value is AuthenticatedReadM2M3Handoff {
  return isRecord(value)
    && hasExactKeys(value, [
      "id", "packageId", "revisionId", "revisionNo", "status",
      "approvedCommitId", "approvedCommitRevisionId", "layoutRevisionId", "selectionRevisionIds", "budget", "createdAt",
    ])
    && isIdentifier(value.id)
    && isUuid(value.packageId)
    && isUuid(value.revisionId)
    && isRevisionNumber(value.revisionNo)
    && value.status === "published"
    && isIdentifier(value.approvedCommitId)
    && isUuid(value.approvedCommitRevisionId)
    && isUuid(value.layoutRevisionId)
    && Array.isArray(value.selectionRevisionIds)
    && value.selectionRevisionIds.length > 0
    && value.selectionRevisionIds.every(isIdentifier)
    && new Set(value.selectionRevisionIds).size === value.selectionRevisionIds.length
    && isApprovedCommitBudget(value.budget)
    && isTimestamp(value.createdAt);
}

function parseAuthenticatedProjectRead(value: unknown): AuthenticatedProjectReadResult {
  if (!isRecord(value) || !hasExactKeys(value, [
    "contractVersion",
    "requestId",
    "data",
    "error",
    "scope",
    "stateRevision",
  ])) {
    throw new Error("Invalid ProjectCEO authenticated read envelope");
  }
  const validCommonFields = value.contractVersion === AUTHENTICATED_READ_CONTRACT_VERSION
    && typeof value.requestId === "string"
    && value.requestId.length > 0;
  if (value.data === null || value.scope === null || value.stateRevision === null) {
    if (!validCommonFields
      || value.data !== null
      || value.scope !== null
      || value.stateRevision !== null
      || !isRecord(value.error)
      || !hasExactKeys(value.error, ["code", "messageKey"])
      || (value.error.code !== "forbidden"
        && value.error.code !== "not_found"
        && value.error.code !== "validation_failed")
      || value.error.messageKey !== `projectceo.read.${value.error.code}`
    ) {
      throw new Error("Invalid ProjectCEO authenticated read envelope");
    }
    return value as unknown as AuthenticatedProjectReadControlledError;
  }
  if (!isRecord(value.data)
    || !isRecord(value.scope)
    || !hasExactKeys(value.scope, [
    "accessScope",
    "actorUserId",
    "organizationId",
    "packageId",
    "projectId",
  ])) {
    throw new Error("Invalid ProjectCEO authenticated read envelope");
  }
  const data = value.data;
  const scope = value.scope;
  const projectMetadata = isRecord(data.projectMetadata)
    ? data.projectMetadata
    : null;
  const arrayKeys = [
    "approvalPackages",
    "decisions",
    "distributionSummary",
    "executionPackages",
    "m2ApprovedCommits",
    "m2LayoutVersions",
    "m2ClientReviewSubmissions",
    "m2ClientReviews",
    "m2M3Handoffs",
    "noChangeTerminals",
    "packages",
    "packageVersions",
    "recipientDistributions",
    "releaseArtifacts",
    "releaseRecipients",
    "reviewQueue",
    "selections",
    "sources",
  ] as const;
  const validArrays = arrayKeys.every((key) => Array.isArray(data[key]));
  const validM2ApprovedCommits = Array.isArray(data.m2ApprovedCommits)
    && data.m2ApprovedCommits.every(isApprovedCommit);
  const validM2LayoutVersions = Array.isArray(data.m2LayoutVersions)
    && data.m2LayoutVersions.every(isLayoutVersion);
  const validM2ClientReviewSubmissions = Array.isArray(data.m2ClientReviewSubmissions)
    && data.m2ClientReviewSubmissions.every(isM2ClientReviewSubmission);
  const validM2ClientReviews = Array.isArray(data.m2ClientReviews)
    && data.m2ClientReviews.every(isM2ClientReview);
  const validM2M3Handoffs = Array.isArray(data.m2M3Handoffs)
    && data.m2M3Handoffs.every(isM2M3Handoff);
  // Ключи v7 необязательны (их нет у ролей без поверхности и в старых
  // проекциях), но присутствуя — разбираются так же строго, как остальные:
  // сломанная строка падает на границе адаптера, а не в глубине рендера.
  const validM3DocumentationSheets = data.m3DocumentationSheets === undefined
    || (Array.isArray(data.m3DocumentationSheets)
      && data.m3DocumentationSheets.every(isDocumentationSheet));
  const validM3DocumentationHandoffs = data.m3DocumentationHandoffs === undefined
    || (Array.isArray(data.m3DocumentationHandoffs)
      && data.m3DocumentationHandoffs.every(isDocumentationHandoff));
  const validScope = isUuid(scope.actorUserId)
    && isUuid(scope.organizationId)
    && isUuid(scope.projectId)
    && (scope.packageId === null || isUuid(scope.packageId))
    && (scope.accessScope === "project" || scope.accessScope === "package");
  if (
    !validCommonFields
    || value.error !== null
    || !validArrays
    || !validM2ApprovedCommits
    || !validM2LayoutVersions
    || !validM2ClientReviewSubmissions
    || !validM2ClientReviews
    || !validM2M3Handoffs
    || !validM3DocumentationSheets
    || !validM3DocumentationHandoffs
    || !validScope
    || !isRecord(data.extensionStatus)
    || projectMetadata === null
    || typeof projectMetadata.name !== "string"
    || typeof projectMetadata.location !== "string"
    || projectMetadata.model !== "full_project"
    || typeof projectMetadata.areaM2 !== "number"
    || !Number.isSafeInteger(projectMetadata.areaM2)
    || projectMetadata.areaM2 < 0
    || !isRecord(data.sourceStats)
    || typeof data.unresolvedImpactReviewCount !== "number"
    || !Number.isSafeInteger(data.unresolvedImpactReviewCount)
    || data.unresolvedImpactReviewCount < 0
    || typeof value.stateRevision !== "number"
    || !Number.isSafeInteger(value.stateRevision)
    || value.stateRevision < 0
  ) {
    throw new Error("Invalid ProjectCEO authenticated read envelope");
  }
  return value as unknown as AuthenticatedProjectReadEnvelope;
}

/** Authenticated, request-bound and read-only AP1 projection. */
export class ProjectCeoAuthenticatedReadPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async getProjectWorkspaceRead(input: {
    readonly projectId: string;
    readonly packageId: string | null;
  }): Promise<AuthenticatedProjectReadResult> {
    return parseAuthenticatedProjectRead(
      await callRpc(
        this.client,
        "projectceo_read_api",
        "get_project_workspace_read_v9",
        {
          project_id: input.projectId,
          package_id: input.packageId,
        },
      ),
    );
  }
}
