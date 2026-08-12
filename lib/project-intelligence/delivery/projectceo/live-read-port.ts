import "server-only";

import {
  FoundationPostgresAdapter,
  ProjectCeoAuthenticatedReadPostgresAdapter,
  ProjectIntelligenceAdapterError,
  type AuthenticatedProjectReadProjection,
  type AuthenticatedReadReleaseRecipient,
  type ExecutionDeliveryEnvelope,
  type FoundationErrorCode,
  type PostgresRpcClient,
  type ProjectListItem,
} from "../../adapters/postgres";
import {
  PROJECTCEO_UI_CONTRACT_VERSION,
  type AccessGrantView,
  type ApprovalPackageView,
  type AuditEventView,
  type BaselineSummary,
  type ChangeImpactCoverageView,
  type ChangeRequestView,
  type DecisionView,
  type EvidenceView,
  type InvitationView,
  type OnboardingState,
  type ParticipantView,
  type PhotoMilestoneView,
  type PortfolioView,
  type ProjectCeoActor,
  type M2BudgetFrameView,
  type M2ApprovedCommitView,
  type M2ClientHandoffView,
  type M2ClientReviewSubmissionView,
  type M2ClientReviewView,
  type M2M3HandoffView,
  type M2LayoutVersionView,
  type M2MaterialView,
  type M2RoomView,
  type M2VariantView,
  type ProjectCeoOperationState,
  type ProjectCeoOperationStates,
  type ProjectCeoRole,
  type ProjectPackageView,
  type ProjectSummary,
  type ProjectWorkspaceView,
  type ReleaseSummary,
  type SelectionView,
  type DocumentationView,
  type SourceRegistryItem,
  type UiEnvelope,
  type UiError,
} from "@/components/projectceo/contracts";
import type { ProjectCeoUiReadPort } from "@/components/projectceo/port";
import { capabilitiesForRole, can } from "@/components/projectceo/role-policy";
import { ru } from "@/lib/i18n/ru";
import { reviewPackageCompleteness } from "../../modules/documentation";
import { isDocumentationModuleEnabled } from "./documentation-flag";
import {
  EXECUTION_INCREMENT_2_COMMANDS,
  EXECUTION_MODULE,
  isExecutionModuleEnabled,
} from "./execution-flag";
import { buildBaselineSnapshot } from "../../modules/decisions";
import { buildReleaseSnapshot } from "../../modules/package/release-snapshot";
import type { ProjectCeoVerifiedIdentity } from "./request-context";

type UnknownRecord = Readonly<Record<string, unknown>>;

const copy = ru.projectCeo;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function rows(value: unknown): readonly UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : fallback;
}

function timestamp(value: unknown): string {
  const candidate = text(value);
  return candidate && !Number.isNaN(Date.parse(candidate))
    ? candidate
    : new Date(0).toISOString();
}

function semanticHash(value: unknown): `sha256:${string}` | null {
  const candidate = text(value);
  return /^sha256:[0-9a-f]{64}$/i.test(candidate)
    ? candidate as `sha256:${string}`
    : null;
}

function roleFromDatabase(role: ProjectListItem["role"]): ProjectCeoRole {
  if (role === "owner_lead") return "owner";
  if (role === "client_approver") return "client";
  return role;
}

function uiError(code: FoundationErrorCode): UiError {
  return {
    code,
    messageKey: `project_ceo.error.${code}`,
    retryable: code === "internal_error" || code === "rate_limited" || code === "stale_state",
  };
}

function errorCode(error: unknown): FoundationErrorCode {
  return error instanceof ProjectIntelligenceAdapterError
    ? error.code
    : "internal_error";
}

function success<T>(requestId: string, data: T): UiEnvelope<T> {
  return {
    contractVersion: PROJECTCEO_UI_CONTRACT_VERSION,
    requestId,
    data,
    error: null,
  };
}

function failure<T>(requestId: string, code: FoundationErrorCode): UiEnvelope<T> {
  return {
    contractVersion: PROJECTCEO_UI_CONTRACT_VERSION,
    requestId,
    data: null,
    error: uiError(code),
  };
}

function requiredData<T>(envelope: {
  readonly data: T | null;
  readonly error: { readonly code: FoundationErrorCode } | null;
}): T {
  if (envelope.error || envelope.data === null) {
    throw new ProjectIntelligenceAdapterError(
      envelope.error?.code ?? "internal_error",
      null,
    );
  }
  return envelope.data;
}

function effectiveScope(
  entries: readonly ProjectListItem[],
  projectId: string,
): ProjectListItem | null {
  const matching = entries.filter((entry) => entry.projectId === projectId);
  if (new Set(matching.map((entry) => entry.organizationId)).size > 1) {
    throw new ProjectIntelligenceAdapterError("scope_conflict", null);
  }
  const projectScope = matching.find((entry) => entry.accessScope === "project");
  if (projectScope) return projectScope;
  if (matching.length > 1) {
    // The v0.1 UI actor DTO cannot yet express per-package roles for siblings.
    // Never collapse those grants to an arbitrary lexicographic package.
    throw new ProjectIntelligenceAdapterError("scope_conflict", null);
  }
  return matching[0] ?? null;
}

function actorFor(
  identity: ProjectCeoVerifiedIdentity,
  entry: ProjectListItem,
): ProjectCeoActor {
  const role = roleFromDatabase(entry.role);
  return {
    actorId: identity.userId,
    role,
    displayName: identity.displayName,
    projectId: entry.projectId,
    packageId: entry.accessScope === "package" ? entry.packageId ?? null : null,
    capabilities: capabilitiesForRole(role),
  };
}

function projectPackages(summary: UnknownRecord): readonly ProjectPackageView[] {
  return rows(summary.packages).flatMap((item) => {
    const id = nullableText(item.id);
    const kind = item.kind === "project_root" || item.kind === "work_package"
      ? item.kind
      : null;
    if (!id || !kind) return [];
    return [{
      id,
      name: text(item.name, copy.common.livePackage),
      kind,
      status: item.status === "archived" ? "archived" as const : "active" as const,
      exactScope: true,
    }];
  });
}

function sourceViews(value: unknown): readonly SourceRegistryItem[] {
  return rows(value).flatMap((item, index) => {
    const id = nullableText(item.id);
    const packageId = nullableText(item.packageId);
    if (!id || !packageId) return [];
    const checksum = nullableText(item.checksum);
    const sourceRole = text(item.sourceRole, text(item.disciplineKey, copy.common.liveSource));
    const mediaType = text(item.mediaType).toLowerCase();
    const sourceKind = text(item.kind).toLowerCase();
    const mediaKind: SourceRegistryItem["mediaKind"] =
      mediaType.includes("pdf") || sourceKind === "pdf" ? "pdf"
        : mediaType.startsWith("image/") || sourceKind === "image" ? "image"
          : mediaType.includes("spreadsheet") || mediaType.includes("excel") ? "spreadsheet"
            : mediaType.includes("dwg") || mediaType.includes("cad") ? "cad_binary"
              : mediaType.includes("zip") || mediaType.includes("rar") ? "archive"
                : mediaType.startsWith("text/") || sourceKind === "plain_text" ? "plain_text"
                  : "document";
    const quarantine: SourceRegistryItem["quarantine"] = item.semanticConflict === true
      ? "semantic_conflict"
      : mediaKind === "cad_binary" || mediaKind === "archive"
        ? "preview_required"
        : null;
    const reviewStatus = item.reviewStatus === "confirmed"
      || item.reviewStatus === "rejected"
      ? item.reviewStatus
      : "pending";
    return [{
      id,
      sourceRevisionId: nullableText(item.sourceRevisionId),
      reviewTargetRevisionId: nullableText(item.reviewTargetRevisionId),
      displayCode: `SRC-${String(index + 1).padStart(3, "0")}`,
      packageId,
      floor: text(item.floorKey, copy.common.liveArea),
      zone: text(item.zoneKey, copy.common.liveArea),
      discipline: sourceRole,
      mediaKind,
      availability: item.availability === "materialized" ? "materialized" : "placeholder",
      documentStatus: item.documentStatus === "current"
        || item.documentStatus === "previous"
        || item.documentStatus === "reference"
        ? item.documentStatus
        : "unknown",
      checksumShort: checksum ? `${checksum.slice(0, 12)}…` : null,
      duplicateAliasCount: 0,
      quarantine,
      evidenceEligible: Boolean(checksum)
        && nullableText(item.sourceRevisionId) !== null
        && quarantine === null
        && reviewStatus === "confirmed",
      reviewStatus,
    }];
  });
}

function baselineFrom(delivery: AuthenticatedProjectReadProjection): BaselineSummary {
  const latest = record(delivery.latestBaseline);
  const id = nullableText(latest.id) ?? nullableText(latest.versionId);
  if (!id) {
    return {
      id: null,
      versionNo: 0,
      status: "draft",
      blockerCount: 0,
      semanticHash: null,
      publishedAt: null,
    };
  }
  return {
    id,
    versionNo: integer(latest.versionNo),
    status: "published",
    blockerCount: 0,
    semanticHash: semanticHash(latest.semanticHash) ?? semanticHash(latest.graphDigest),
    publishedAt: nullableText(latest.publishedAt),
  };
}

function releaseViews(
  delivery: AuthenticatedProjectReadProjection,
  packages: readonly ProjectPackageView[],
): readonly ReleaseSummary[] {
  const packageVersions = rows(delivery.packageVersions);
  const distributionSummary = rows(delivery.distributionSummary);
  const recipientDistributions = rows(delivery.recipientDistributions);
  const maxVersion = new Map<string, number>();
  for (const version of packageVersions) {
    const packageId = text(version.packageId);
    maxVersion.set(packageId, Math.max(maxVersion.get(packageId) ?? 0, integer(version.versionNo)));
  }
  return packageVersions.flatMap((version) => {
    const id = nullableText(version.id);
    const packageId = nullableText(version.packageId);
    const hash = semanticHash(version.semanticHash);
    if (!id || !packageId || !hash) return [];
    const summary = distributionSummary.find((item) => (
      item.productionPackageVersionId === id && item.packageId === packageId
    ));
    const acknowledgementCount = integer(summary?.acknowledgementCount);
    const recipientCount = integer(summary?.recipientCount);
    const recipientDistribution = recipientDistributions.find((item) => (
      item.productionPackageVersionId === id
      && item.packageId === packageId
      && item.acknowledged !== true
    ));
    return [{
      id,
      packageId,
      packageName: packages.find((item) => item.id === packageId)?.name ?? copy.common.livePackage,
      versionNo: integer(version.versionNo),
      status: integer(version.versionNo) === maxVersion.get(packageId) ? "current" : "superseded",
      semanticHash: hash,
      distributionStatus: recipientCount === 0
        ? "draft"
        : acknowledgementCount === recipientCount
          ? "acknowledged"
          : acknowledgementCount > 0
            ? "partially_acknowledged"
            : "distributed",
      acknowledgementCount,
      recipientCount,
      publishedAt: timestamp(version.publishedAt),
      // The AP1 contract returns an identifier only for auth.uid()'s own
      // unacknowledged distribution. Aggregate counts never expose recipients.
      pendingDistributionId: nullableText(recipientDistribution?.distributionId),
    }];
  });
}

function evidenceViews(value: unknown): readonly EvidenceView[] {
  return rows(value).flatMap((item) => {
    const evidenceId = nullableText(item.evidenceLinkId);
    const sourceCode = nullableText(item.sourceId);
    const sourceRevision = nullableText(item.sourceRevisionId);
    if (!evidenceId || !sourceCode || !sourceRevision) return [];
    const locator = record(item.locator);
    const locatorValue = nullableText(locator.page)
      ?? nullableText(locator.sheet)
      ?? nullableText(locator.cellRange)
      ?? nullableText(locator.part);
    return [{
      evidenceId,
      sourceCode,
      sourceRevision,
      locatorLabel: locatorValue
        ? `${text(item.locatorKind, "source")}: ${locatorValue}`
        : text(item.locatorKind, "source"),
    }];
  });
}

function decisionViews(value: unknown): readonly DecisionView[] {
  return rows(value).flatMap((item) => {
    const id = nullableText(item.id);
    const revisionId = nullableText(item.revisionId);
    if (!id || !revisionId) return [];
    const claimStatus: DecisionView["claimStatus"] = item.claimStatus === "extracted"
      || item.claimStatus === "interpreted"
      || item.claimStatus === "human_origin"
      ? item.claimStatus
      : "unknown";
    const reviewStatus: DecisionView["reviewStatus"] = item.reviewStatus === "approved"
      || item.reviewStatus === "change_requested"
      ? item.reviewStatus
      : "submitted";
    return [{
      id,
      packageId: text(item.packageId),
      areaNodeId: nullableText(item.areaNodeId),
      title: text(item.title, copy.common.dash),
      resolution: text(item.resolution, copy.common.dash),
      revisionId,
      revisionNo: integer(item.revisionNo),
      claimStatus,
      reviewStatus,
      evidence: evidenceViews(item.evidence),
    }];
  });
}

function selectionViews(value: unknown): readonly SelectionView[] {
  return rows(value).flatMap((item) => {
    const id = nullableText(item.id);
    const packageId = nullableText(item.packageId);
    const revisionId = nullableText(item.revisionId);
    const decisionRevisionId = nullableText(item.decisionRevisionId);
    if (!id || !packageId || !revisionId || !decisionRevisionId) return [];
    const specification = Object.entries(record(item.specification))
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([label, value]) => ({
        label,
        value: typeof value === "string" ? value : JSON.stringify(value),
      }));
    const price = record(item.priceObservation);
    const amountRub = integer(price.amountRub, -1);
    const reviewStatus: SelectionView["reviewStatus"] = item.reviewStatus === "submitted"
      || item.reviewStatus === "approved"
      || item.reviewStatus === "rejected"
      || item.reviewStatus === "change_requested"
      ? item.reviewStatus
      : "draft";
    return [{
      id,
      title: text(item.title, copy.common.dash),
      area: text(item.area, copy.common.liveArea),
      packageId,
      areaNodeId: nullableText(item.areaNodeId),
      revisionNo: integer(item.revisionNo),
      revisionId,
      decisionRevisionId,
      reviewStatus,
      specification,
      priceObservation: amountRub >= 0 ? {
        amountRub,
        checkedAt: timestamp(price.checkedAt),
        sourceCode: text(price.sourceId, copy.common.liveSource),
      } : null,
      evidence: evidenceViews(item.evidence),
      revisionHistory: rows(item.revisionHistory).flatMap((history) => {
        const historyId = nullableText(history.revisionId);
        if (!historyId) return [];
        return [{
          revisionNo: integer(history.revisionNo),
          revisionId: historyId,
          reason: text(history.reason, copy.common.dash),
          status: history.status === "current" ? "current" as const : "superseded" as const,
        }];
      }),
    }];
  });
}

function approvalPackageViews(value: unknown): readonly ApprovalPackageView[] {
  return rows(value).flatMap((item) => {
    const id = nullableText(item.id);
    const packageId = nullableText(item.packageId);
    if (!id || !packageId) return [];
    const rawStatus = item.status;
    const status: ApprovalPackageView["status"] = rawStatus === "submitted"
      || rawStatus === "approved"
      || rawStatus === "rejected"
      || rawStatus === "change_requested"
      ? rawStatus
      : "draft";
    const items = rows(item.items).flatMap((entry) => {
      const targetKind = entry.targetKind;
      if (targetKind !== "requirement_revision"
        && targetKind !== "assumption_revision"
        && targetKind !== "decision_revision"
        && targetKind !== "selection_revision") return [];
      const entityId = nullableText(entry.entityId);
      const revisionId = nullableText(entry.revisionId);
      if (!entityId || !revisionId) return [];
      return [{
        targetKind: targetKind as ApprovalPackageView["items"][number]["targetKind"],
        entityId,
        revisionId,
      }];
    });
    return [{
      id,
      packageId,
      status,
      selfApproved: item.selfApproved === true,
      items,
      createdAt: timestamp(item.createdAt),
    }];
  });
}

type M2RevisionStatus = M2RoomView["status"];

function m2Status(value: unknown): M2RevisionStatus {
  return value === "submitted" || value === "approved" || value === "ready"
    ? value
    : "draft";
}

function m2RevisionBase(item: UnknownRecord): {
  readonly id: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly payload: UnknownRecord;
  readonly status: M2RevisionStatus;
  readonly createdAt: string;
} | null {
  const id = nullableText(item.id);
  const packageId = nullableText(item.packageId);
  const revisionId = nullableText(item.revisionId);
  if (!id || !packageId || !revisionId) return null;
  return {
    id,
    packageId,
    revisionId,
    revisionNo: integer(item.revisionNo, 1),
    payload: record(item.payload),
    status: m2Status(item.status),
    createdAt: timestamp(item.createdAt),
  };
}

function m2WorkspaceViews(value: unknown): {
  readonly rooms: readonly M2RoomView[];
  readonly variants: readonly M2VariantView[];
  readonly materials: readonly M2MaterialView[];
  readonly budgets: readonly M2BudgetFrameView[];
  readonly handoffs: readonly M2ClientHandoffView[];
} {
  const parse = (key: string) => rows(record(value)[key]);
  const rooms = parse("m2Rooms").flatMap((item) => {
    const base = m2RevisionBase(item);
    const name = text(base?.payload.name);
    const areaM2 = integer(base?.payload.areaM2);
    return base && name ? [{ ...base, name, areaM2 }] : [];
  });
  const variants = parse("m2Variants").flatMap((item) => {
    const base = m2RevisionBase(item);
    const roomId = nullableText(base?.payload.roomId);
    const title = text(base?.payload.title);
    return base && roomId && title
      ? [{ ...base, roomId, title, description: text(base.payload.description) }]
      : [];
  });
  const materials = parse("m2Materials").flatMap((item) => {
    const base = m2RevisionBase(item);
    const variantId = nullableText(base?.payload.variantId);
    const name = text(base?.payload.name);
    return base && variantId && name
      ? [{
          ...base,
          variantId,
          name,
          supplierRef: text(base.payload.supplierRef),
          unit: text(base.payload.unit, "шт"),
          unitCostRub: integer(base.payload.unitCostRub),
          quantity: integer(base.payload.quantity, 1),
        }]
      : [];
  });
  const budgets = parse("m2BudgetFrames").flatMap((item) => {
    const base = m2RevisionBase(item);
    const minRub = integer(base?.payload.minRub);
    const maxRub = integer(base?.payload.maxRub);
    return base && minRub >= 0 && maxRub >= minRub
      ? [{
          ...base,
          currency: "RUB" as const,
          minRub,
          maxRub,
          contingencyPct: integer(base.payload.contingencyPct),
        }]
      : [];
  });
  const handoffs = parse("m2ClientHandoffs").flatMap((item) => {
    const base = m2RevisionBase(item);
    const approvalPackageId = nullableText(base?.payload.approvalPackageId);
    const title = text(base?.payload.title);
    return base && approvalPackageId && title
      ? [{ ...base, approvalPackageId, title, note: text(base.payload.note) }]
      : [];
  });
  return { rooms, variants, materials, budgets, handoffs };
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const SUBMISSION_KEYS = ["approvalPackageId", "roomId", "designIntentRevisionId", "variants", "budgetAsOf", "staleAfterDays", "submittedByActorUserId", "submissionReason", "submittedAt"] as const;
const VARIANT_KEYS = ["variantId", "role", "layoutDocumentId", "layoutVersionId", "layoutRevisionId", "semanticHash", "selectionRevisionIds", "budget"] as const;
const BUDGET_KEYS = ["amountRub", "staleSelectionRevisionIds", "missingPriceSelectionRevisionIds"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function exactObjectKeys(value: UnknownRecord, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}
function exactSubmissionPayload(value: unknown): boolean {
  const payload = record(value);
  if (!exactObjectKeys(payload, SUBMISSION_KEYS) || !Array.isArray(payload.variants) || payload.variants.length !== 3
    || !Number.isFinite(Date.parse(text(payload.budgetAsOf))) || !Number.isSafeInteger(payload.staleAfterDays)) return false;
  const variants = rows(payload.variants);
  const roles = new Set([variants[0]?.role, variants[1]?.role, variants[2]?.role]);
  const variantIds = new Set([variants[0]?.variantId, variants[1]?.variantId, variants[2]?.variantId]);
  const layoutRevisionIds = new Set([variants[0]?.layoutRevisionId, variants[1]?.layoutRevisionId, variants[2]?.layoutRevisionId]);
  if (roles.size !== 3 || variantIds.size !== 3 || layoutRevisionIds.size !== 3) return false;
  return variants.every((variant) => {
    const selectionRevisionIds = stringList(variant.selectionRevisionIds);
    const budget = record(variant.budget);
    const staleSelectionRevisionIds = stringList(budget.staleSelectionRevisionIds);
    const missingPriceSelectionRevisionIds = stringList(budget.missingPriceSelectionRevisionIds);
    return exactObjectKeys(variant, VARIANT_KEYS) && exactObjectKeys(budget, BUDGET_KEYS)
      && UUID.test(text(variant.layoutRevisionId)) && /^sha256:[0-9a-f]{64}$/i.test(text(variant.semanticHash))
      && selectionRevisionIds.length > 0 && new Set(selectionRevisionIds).size === selectionRevisionIds.length
      && Number.isSafeInteger(budget.amountRub) && integer(budget.amountRub, -1) >= 0
      && staleSelectionRevisionIds.every((id) => selectionRevisionIds.includes(id))
      && missingPriceSelectionRevisionIds.every((id) => selectionRevisionIds.includes(id));
  });
}

function m2Cycle6Views(delivery: AuthenticatedProjectReadProjection): {
  readonly m2ClientReviewSubmissions: readonly M2ClientReviewSubmissionView[];
  readonly m2ClientReviews: readonly M2ClientReviewView[];
  readonly m2M3Handoffs: readonly M2M3HandoffView[];
  readonly m2ApprovedCommits: readonly M2ApprovedCommitView[];
  readonly m2LayoutVersions: readonly M2LayoutVersionView[];
} {
  const selectionByRevision = new Map(delivery.selections.map((item) => [item.revisionId, item]));
  const m2ClientReviewSubmissions = delivery.m2ClientReviewSubmissions.flatMap((item) => {
    if (!exactSubmissionPayload(item.payload)) return [];
    const payload = record(item.payload);
    const variants = rows(payload.variants).flatMap((variant) => {
      const budget = record(variant.budget);
      const selectionRevisionIds = stringList(variant.selectionRevisionIds);
      const role = variant.role;
      const semanticHash = nullableText(variant.semanticHash);
      const layoutRevisionId = nullableText(variant.layoutRevisionId);
      if ((role !== "preferred" && role !== "value_engineered" && role !== "premium")
        || !semanticHash?.startsWith("sha256:") || !layoutRevisionId) return [];
      return [{
        variantId: text(variant.variantId), role: role as "preferred" | "value_engineered" | "premium", layoutDocumentId: text(variant.layoutDocumentId),
        layoutVersionId: text(variant.layoutVersionId), layoutRevisionId,
        semanticHash: semanticHash as `sha256:${string}`, selectionRevisionIds,
        selections: selectionRevisionIds.map((revisionId) => ({
          revisionId,
          title: selectionByRevision.get(revisionId)?.title ?? revisionId,
          supplierRef: text(selectionByRevision.get(revisionId)?.specification.supplierRef),
        })),
        budget: {
          amountRub: integer(budget.amountRub),
          staleSelectionRevisionIds: stringList(budget.staleSelectionRevisionIds),
          missingPriceSelectionRevisionIds: stringList(budget.missingPriceSelectionRevisionIds),
        },
      }];
    });
    const id = nullableText(item.id); const packageId = nullableText(item.packageId);
    const revisionId = nullableText(item.revisionId); const assignedClientUserId = nullableText(item.assignedClientUserId);
    if (!id || !packageId || !revisionId || !assignedClientUserId || variants.length !== 3) return [];
    return [{
      id, packageId, revisionId, revisionNo: integer(item.revisionNo, 1), status: "submitted" as const,
      assignedClientUserId, approvalPackageId: text(payload.approvalPackageId), roomId: text(payload.roomId),
      designIntentRevisionId: text(payload.designIntentRevisionId), variants,
      budgetAsOf: text(payload.budgetAsOf), staleAfterDays: integer(payload.staleAfterDays),
      createdAt: timestamp(item.createdAt),
    }];
  });
  const m2ClientReviews = delivery.m2ClientReviews.flatMap((item) => {
    const status = item.status;
    if (status !== "approved" && status !== "rejected" && status !== "change_requested") return [];
    return [{ id: text(item.id), packageId: text(item.packageId), revisionId: text(item.revisionId),
      revisionNo: integer(item.revisionNo, 1), status: status as "approved" | "rejected" | "change_requested", submissionId: text(item.submissionId),
      chosenVariantId: text(item.chosenVariantId), createdAt: timestamp(item.createdAt) }];
  });
  const m2LayoutVersions = delivery.m2LayoutVersions.map((layout) => ({
    documentId: layout.documentId, versionId: layout.versionId, packageId: layout.packageId,
    revisionId: layout.revisionId, roomId: layout.roomId, variantId: layout.variantId,
    role: layout.role, semanticHash: layout.semanticHash,
    selectionRevisionIds: stringList(record(layout.payload.layoutContent).selectionRevisionIds),
  }));
  const m2ApprovedCommits = delivery.m2ApprovedCommits.map((commit) => ({
    id: commit.id, packageId: commit.packageId, revisionId: commit.revisionId,
    layoutRevisionId: commit.payload.chosenVariant.layoutRevisionId ?? "",
    selectionRevisionIds: commit.payload.approvedSelectionRevisionIds,
    amountRub: commit.payload.budget.amountRub ?? null,
    clientSubmissionId: commit.payload.clientSubmissionId ?? null,
  }));
  const m2M3Handoffs = delivery.m2M3Handoffs.map((item) => {
    const approvedCommitId = text(item.approvedCommitId);
    return {
      id: text(item.id), packageId: text(item.packageId), revisionId: text(item.revisionId),
      revisionNo: integer(item.revisionNo, 1), status: "published" as const, approvedCommitId,
      approvedCommitRevisionId: text(item.approvedCommitRevisionId),
      layoutRevisionId: text(item.layoutRevisionId), selectionRevisionIds: stringList(item.selectionRevisionIds),
      budget: { amountRub: integer(item.budget.amountRub) }, createdAt: timestamp(item.createdAt),
    };
  });
  return { m2ClientReviewSubmissions, m2ClientReviews, m2M3Handoffs, m2ApprovedCommits, m2LayoutVersions };
}

function releaseRecipientViews(
  recipients: readonly AuthenticatedReadReleaseRecipient[],
): readonly ParticipantView[] {
  return recipients.map((recipient) => ({
    id: recipient.userId,
    displayName: copy.common.liveParticipant(recipient.userId.slice(0, 8)),
    role: roleFromDatabase(recipient.role),
    scopeLabel: recipient.scope === "package"
      ? copy.common.exactWorkPackage
      : copy.common.allProject,
    status: "active",
  }));
}

function accessViews(
  value: unknown,
): {
  readonly invitations: readonly InvitationView[];
  readonly participants: readonly ParticipantView[];
  readonly grants: readonly AccessGrantView[];
} {
  const data = record(value);
  const invitations: InvitationView[] = rows(data.invitations).flatMap((item) => {
    const id = nullableText(item.invitationId);
    const databaseRole = text(item.role);
    const role = databaseRole === "client_approver" ? "client" : databaseRole;
    if (!id || (role !== "architect" && role !== "builder" && role !== "client")) return [];
    const rawEmail = text(item.recipientEmail);
    const recipientLabel = rawEmail.replace(/^(.).+(@.+)$/, "$1•••$2");
    const status = item.status === "accepted" || item.status === "revoked" || item.status === "expired"
      ? item.status
      : "pending";
    return [{
      id,
      recipientLabel,
      role,
      scopeLabel: item.scope === "package" ? copy.common.exactWorkPackage : copy.common.allProject,
      status,
      expiresAt: timestamp(item.expiresAt),
      shareUrl: null,
    }];
  });
  const projectMembers = rows(data.memberships);
  const packageMembers = rows(data.packageMemberships);
  const participants: ParticipantView[] = [...projectMembers, ...packageMembers].flatMap((item) => {
    const id = nullableText(item.userId);
    const databaseRole = text(item.role);
    const role: ProjectCeoRole | null = databaseRole === "owner_lead" ? "owner"
      : databaseRole === "client_approver" ? "client"
        : databaseRole === "architect" || databaseRole === "builder" ? databaseRole
          : null;
    if (!id || !role) return [];
    return [{
      id,
      displayName: copy.common.liveParticipant(id.slice(0, 8)),
      role,
      scopeLabel: item.scope === "package" ? copy.common.exactWorkPackage : copy.common.allProject,
      status: item.status === "revoked" ? "revoked" : "active",
    }];
  });
  return { invitations, participants, grants: [] };
}

function historyViews(value: unknown): readonly AuditEventView[] {
  return rows(value).map((item, index) => ({
    id: `audit-${index}-${timestamp(item.occurredAt)}`,
    event: text(item.eventType, "project_event"),
    actorRole: "system",
    occurredAt: timestamp(item.occurredAt),
    controlledDetail: Object.keys(record(item.metadata)).sort().join(", ") || copy.common.dash,
  }));
}

/**
 * Покрытие обхода влияния (DEC-033) из проекции `impactRuns[]`. `null`, если
 * поле покрытия отсутствует в ответе — прогон посчитан старым контрактом
 * (`/0.1`) или запись повреждена; тогда честнее не показывать статус вовсе,
 * чем угадать его.
 */
function impactCoverageView(
  run: UnknownRecord,
  reviewedCount: number,
  totalCount: number,
): ChangeImpactCoverageView | null {
  const coverageStatus = run.coverageStatus;
  if (
    coverageStatus !== "complete"
    && coverageStatus !== "partial_depth"
    && coverageStatus !== "blocked_result_limit"
  ) {
    return null;
  }
  const cutoffReasonRaw = run.cutoffReason;
  const cutoffReason = cutoffReasonRaw === "depth_boundary" || cutoffReasonRaw === "result_limit"
    ? cutoffReasonRaw
    : null;
  const coverageComplete = coverageStatus === "complete";
  // Ноль возвращённых карточек (blocked_result_limit) значит «нечего
  // рассматривать», и это истинно вакуумно — так же, как считает сама RPC
  // `review_change_impact` (`not exists (unreviewed)` на пустом множестве).
  const allReturnedImpactsReviewed = reviewedCount === totalCount;
  return {
    coverageStatus,
    cutoffReason,
    hasMoreBeyondDepth: run.hasMoreBeyondDepth === true,
    knownImpactCountLowerBound: integer(run.knownImpactCountLowerBound),
    maxDepth: integer(run.maxDepth),
    maxImpacts: integer(run.maxImpacts),
    policyVersion: text(run.policyVersion),
    returnedImpactCount: integer(run.returnedImpactCount),
    allReturnedImpactsReviewed,
    coverageComplete,
    impactReviewComplete: allReturnedImpactsReviewed && coverageComplete,
  };
}

function m4Views(envelopes: readonly ExecutionDeliveryEnvelope[]): {
  readonly changes: readonly ChangeRequestView[];
  readonly milestones: readonly PhotoMilestoneView[];
  readonly handover: ProjectWorkspaceView["handover"];
} {
  const changes: ChangeRequestView[] = [];
  const milestones: PhotoMilestoneView[] = [];
  const allAreaIds = new Set<string>();
  const acceptedAreaIds = new Set<string>();
  let warrantyDocumentCount = 0;
  let archiveHash: `sha256:${string}` | null = null;
  for (const envelope of envelopes) {
    for (const request of envelope.data.changeRequests) {
      const id = nullableText(request.id);
      if (!id) continue;
      const impactRun = envelope.data.impactRuns.find((run) => run.changeRequestId === id);
      const impacts = rows(impactRun?.impacts);
      const reviewed = impacts.filter((impact) => nullableText(impact.disposition)).length;
      const impactRunId = nullableText(impactRun?.id);
      changes.push({
        id,
        title: copy.workspace.changes.newTitle,
        status: impactRun ? "impact_review" : "submitted",
        fromBaseline: text(request.fromBaselineId, copy.common.dash),
        toBaseline: nullableText(request.proposedBaselineId),
        deltaRub: integer(request.deltaCostRub),
        deltaDays: integer(request.deltaDays),
        requestedAt: timestamp(request.requestedAt),
        impactCount: impacts.length,
        reviewedImpactCount: reviewed,
        reason: text(request.reason, copy.common.dash),
        coverage: impactRun ? impactCoverageView(impactRun, reviewed, impacts.length) : null,
        impacts: impactRunId ? impacts.flatMap((impact) => {
          const impactId = nullableText(impact.id);
          if (!impactId) return [];
          const disposition = impact.disposition === "accepted"
            || impact.disposition === "resolved"
            || impact.disposition === "dismissed"
            ? impact.disposition
            : null;
          return [{
            impactRunId,
            impactId,
            label: text(impact.impactedNodeId, copy.common.dash),
            disposition,
          }];
        }) : [],
      });
    }
    for (const milestone of envelope.data.milestones) {
      const id = nullableText(milestone.id);
      if (!id) continue;
      const areas = rows(milestone.areas);
      for (const area of areas) {
        const areaId = nullableText(area.areaNodeId);
        if (!areaId) continue;
        allAreaIds.add(areaId);
        if (milestone.acceptance) acceptedAreaIds.add(areaId);
      }
      const photos = areas.flatMap((area) => rows(area.photos));
      const rejected = photos.some((photo) => photo.decision === "rejected");
      milestones.push({
        id,
        packageId: envelope.scope.packageId,
        area: areas.length === 1 ? text(areas[0]?.areaNodeId, copy.common.liveArea) : copy.common.liveArea,
        milestone: text(milestone.title, copy.common.livePackage),
        photoCount: photos.length,
        status: milestone.acceptance ? "accepted" : rejected ? "change_requested" : "submitted",
        submittedAt: photos.length ? timestamp(photos[0]?.capturedAt) : new Date(0).toISOString(),
        areas: areas.flatMap((area) => {
          const areaNodeId = nullableText(area.areaNodeId);
          if (!areaNodeId) return [];
          return [{
            areaNodeId,
            photos: rows(area.photos).flatMap((photo) => {
              const id = nullableText(photo.id);
              if (!id) return [];
              const decision = photo.decision === "accepted" || photo.decision === "rejected"
                ? photo.decision
                : null;
              return [{
                id,
                capturedAt: timestamp(photo.capturedAt),
                decision,
              }];
            }),
          }];
        }),
      });
    }
    warrantyDocumentCount += envelope.data.handoverDocuments.filter((item) => (
      item.documentKind === "warranty"
    )).length;
    const latestHandover = envelope.data.constructionHandovers[0];
    archiveHash = semanticHash(latestHandover?.semanticHash) ?? archiveHash;
  }
  return {
    changes,
    milestones,
    handover: {
      status: archiveHash ? "archived" : allAreaIds.size > 0 && acceptedAreaIds.size === allAreaIds.size
        ? "ready"
        : "not_ready",
      acceptedAreaCount: acceptedAreaIds.size,
      totalAreaCount: allAreaIds.size,
      warrantyDocumentCount,
      archiveHash,
    },
  };
}

function unavailable(reason: Exclude<ProjectCeoOperationState, { readonly status: "available" }>["reason"]): ProjectCeoOperationState {
  return { status: "unavailable", reason };
}

/**
 * Раздел документации: прочитанные листы и комплектность по каждому
 * утверждённому решению M2.
 *
 * Комплектность считает код модуля на реальных данных, а не отдельная
 * реализация в слое доставки: иначе интерфейс однажды начал бы называть
 * неполноту по своим правилам, а модуль — по своим. Раздел равен null, когда
 * поверхности нет вовсе: модуль выключен либо роль не получает листов.
 */
function documentationView(input: {
  readonly delivery: AuthenticatedProjectReadProjection;
  readonly enabled: boolean;
}): DocumentationView | null {
  if (!input.enabled) return null;
  const sheets = input.delivery.m3DocumentationSheets;
  const handoffs = input.delivery.m3DocumentationHandoffs;
  // Проекция не отдала ключей вовсе — значит эта роль их не получает.
  if (sheets === undefined || handoffs === undefined) return null;

  const domainSheets = sheets.map((sheet) => ({
    sheetId: sheet.sheetId,
    // Проекция не повторяет идентификатор проекта в каждой строке: он один на
    // весь ответ и в проверке комплектности не участвует.
    projectId: "",
    packageId: sheet.packageId,
    roomId: sheet.roomId,
    sheetNumber: sheet.sheetNumber,
    title: sheet.title,
    revision: {
      revisionId: sheet.revisionId,
      revisionNo: sheet.revisionNo,
      createdAt: sheet.createdAt,
      createdBy: { actorId: sheet.createdByUserId, actorType: "human" as const },
      reason: sheet.reason,
    },
    origin: {
      handoffContractVersion: sheet.origin.handoffContractVersion,
      approvedM2CommitRevisionId: sheet.origin.approvedM2CommitRevisionId,
      designIntentRevisionId: sheet.origin.designIntentRevisionId,
      layoutDocumentId: sheet.origin.layoutDocumentId,
      layoutVersionId: sheet.origin.layoutVersionId,
      layoutRevisionId: sheet.origin.layoutRevisionId,
      semanticHash: sheet.origin.semanticHash,
    },
    specificationRevisionIds: sheet.specificationRevisionIds,
  }));

  return {
    sheets: sheets.map((sheet) => ({
      sheetId: sheet.sheetId,
      packageId: sheet.packageId,
      sheetNumber: sheet.sheetNumber,
      title: sheet.title,
      roomId: sheet.roomId,
      revisionId: sheet.revisionId,
      revisionNo: sheet.revisionNo,
      specificationRevisionIds: sheet.specificationRevisionIds,
      layoutSemanticHash: sheet.origin.semanticHash,
      approvedM2CommitRevisionId: sheet.origin.approvedM2CommitRevisionId,
    })),
    completeness: handoffs.map((handoff) => {
      // Отчёту передаются листы его утверждения плюс осиротевшие — те, чей
      // approved commit не совпадает ни с одним ТЕКУЩИМ handoff пакета. Лист
      // соседней комнаты (другой текущий handoff того же пакета) — не «чужое
      // утверждение», а параллельное; вечно клеймить его в каждом отчёте
      // значило бы сделать complete=true недостижимым в многокомнатном пакете.
      const currentCommits = new Set(
        handoffs
          .filter((item) => item.packageId === handoff.packageId)
          .map((item) => item.approvedM2CommitRevisionId),
      );
      const report = reviewPackageCompleteness({
        handoff: {
          contractVersion: handoff.contractVersion,
          projectId: "",
          packageId: handoff.packageId,
          roomId: handoff.roomId,
          approvedM2CommitRevisionId: handoff.approvedM2CommitRevisionId,
          designIntentRevisionId: handoff.designIntentRevisionId,
          layout: handoff.layout,
          selectionRevisionIds: handoff.selectionRevisionIds,
        },
        sheets: domainSheets.filter((sheet) => (
          sheet.packageId === handoff.packageId
          && (
            sheet.origin.approvedM2CommitRevisionId === handoff.approvedM2CommitRevisionId
            || !currentCommits.has(sheet.origin.approvedM2CommitRevisionId)
          )
        )),
      });
      return {
        handoffId: handoff.handoffId,
        handoffRevisionId: handoff.revisionId,
        packageId: handoff.packageId,
        roomId: handoff.roomId,
        complete: report.complete,
        findings: report.findings.map((finding) => ({
          code: finding.code,
          subject: finding.subject,
        })),
      };
    }),
  };
}

function operationStates(input: {
  readonly role: ProjectCeoRole;
  readonly delivery: AuthenticatedProjectReadProjection;
  readonly m4: readonly ExecutionDeliveryEnvelope[];
  readonly documentationEnabled?: boolean;
  readonly executionEnabled?: boolean;
}): ProjectCeoOperationStates {
  const documentationEnabled = input.documentationEnabled
    ?? isDocumentationModuleEnabled();
  const executionEnabled = input.executionEnabled ?? isExecutionModuleEnabled();
  const supports = (capability: Parameters<typeof can>[1]): ProjectCeoOperationState => (
    can(input.role, capability) ? { status: "available" } : unavailable("capability_missing")
  );
  const packageVersions = rows(input.delivery.packageVersions);
  const releaseArtifacts = rows(input.delivery.releaseArtifacts);
  const latestBaseline = nullableText(record(input.delivery.latestBaseline).id);
  const changeReady = packageVersions.some((version) => (
    nullableText(version.baselineId) && version.baselineId !== latestBaseline
  ));
  const pendingDistribution = input.delivery.recipientDistributions.find(
    (distribution) => !distribution.acknowledged,
  );
  const approvalPackages = rows(input.delivery.approvalPackages);
  const hasDraftApproval = approvalPackages.some((approval) => approval.status === "draft");
  const hasSubmittedApproval = approvalPackages.some((approval) => approval.status === "submitted");
  const distributableVersionId = nullableText(
    releaseArtifacts.find((artifact) => (
      nullableText(artifact.artifactId) !== null
      && input.delivery.releaseRecipients.length > 0
    ))?.productionPackageVersionId,
  );
  let unreviewedImpactId: string | null = null;
  let uploadMilestoneId: string | null = null;
  let undecidedPhotoId: string | null = null;
  let acceptableMilestoneId: string | null = null;
  const publishedDocumentationHandoff =
    (input.delivery.m3DocumentationHandoffs?.length ?? 0) > 0;
  const hasDocumentationSheet =
    (input.delivery.m3DocumentationSheets?.length ?? 0) > 0;
  const pendingSourceRevisionId = nullableText(
    input.delivery.sources.find((source) => (
      source.reviewStatus === "pending"
      && source.reviewTargetRevisionId !== null
    ))?.reviewTargetRevisionId,
  );
  // Снапшот состава baseline: то же правило полноты, что применит команда, и
  // тот же токен, который она потребует назад.
  let baselineSnapshotToken: string | null = null;
  try {
    baselineSnapshotToken = buildBaselineSnapshot({
      approvalPackages: rows(input.delivery.approvalPackages).map((entry) => ({
        id: text(entry.id),
        status: text(entry.status),
        createdAt: text(entry.createdAt),
        items: rows(entry.items).map((item) => ({
          targetKind: text(item.targetKind),
          entityId: text(item.entityId),
          revisionId: text(item.revisionId),
        })),
      })),
      packageIds: rows(input.delivery.packages).flatMap((entry) => {
        const id = nullableText(entry.id);
        return id ? [id] : [];
      }),
      previousBaselineId: nullableText(record(input.delivery.latestBaseline).id),
    }).token;
  } catch {
    baselineSnapshotToken = null;
  }
  // Снапшот версии пакета: тот же приём, что у baseline, шагом позже. Состав
  // берётся из опубликованного baseline (чтение v9, `20260810090000`), а не из
  // одобренного «сейчас» — версия обязана выражать замороженное, иначе RPC
  // отказывает `PACKAGE_REF_NOT_IN_BASELINE`.
  let releaseSnapshotToken: string | null = null;
  const rootPackageId = nullableText(
    rows(input.delivery.packages).find((entry) => text(entry.kind) === "project_root")?.id,
  );
  const latestBaselineRecord = record(input.delivery.latestBaseline);
  const baselineRefsRecord = record(latestBaselineRecord.exactRevisionRefs);
  const refGroup = (key: string): readonly string[] => (
    Array.isArray(baselineRefsRecord[key])
      ? (baselineRefsRecord[key] as unknown[]).flatMap((value) => {
        const id = nullableText(value);
        return id ? [id] : [];
      })
      : []
  );
  if (rootPackageId && latestBaseline) {
    try {
      releaseSnapshotToken = buildReleaseSnapshot({
        packageId: rootPackageId,
        baselineId: latestBaseline,
        previousVersionId: packageVersions
          .filter((version) => nullableText(version.packageId) === rootPackageId)
          .reduce<{ id: string | null; versionNo: number }>((latest, version) => {
            const versionNo = Number(version.versionNo ?? 0);
            return versionNo > latest.versionNo
              ? { id: nullableText(version.id), versionNo }
              : latest;
          }, { id: null, versionNo: 0 }).id,
        baselineRefs: {
          sources: refGroup("sources"),
          requirements: refGroup("requirements"),
          assumptions: refGroup("assumptions"),
          decisions: refGroup("decisions"),
          selections: refGroup("selections"),
        },
      }).token;
    } catch {
      // Пустой baseline или негодный идентификатор — действие не предлагается.
      // Обещать выпуск, который RPC отвергнет, хуже, чем не предлагать его.
      releaseSnapshotToken = null;
    }
  }
  const photoSourcePackageIds = new Set(
    input.delivery.sources.filter((source) => (
      source.availability === "materialized"
      && source.sourceRevisionId !== null
      && (source.kind === "image" || source.mediaType?.startsWith("image/") === true)
    )).map((source) => source.packageId),
  );
  for (const envelope of input.m4) {
    for (const run of envelope.data.impactRuns) {
      for (const impact of rows(run.impacts)) {
        if (!nullableText(impact.disposition)) {
          unreviewedImpactId ??= nullableText(impact.id);
        }
      }
    }
    for (const milestone of envelope.data.milestones) {
      const milestoneId = nullableText(milestone.id);
      if (!milestoneId || milestone.acceptance) continue;
      const areas = rows(milestone.areas);
      if (
        areas.some((area) => nullableText(area.areaNodeId))
        && photoSourcePackageIds.has(envelope.scope.packageId)
      ) {
        uploadMilestoneId ??= milestoneId;
      }
      const photos = areas.flatMap((area) => rows(area.photos));
      if (
        photos.length > 0
        && photos.every((photo) => photo.decision === "accepted")
      ) {
        acceptableMilestoneId ??= milestoneId;
      }
      for (const photo of photos) {
        if (!nullableText(photo.decision)) {
          undecidedPhotoId ??= nullableText(photo.id);
        }
      }
    }
  }
  const states: ProjectCeoOperationStates = {
    create_invitation: can(input.role, "manage_access")
      ? { status: "available" }
      : unavailable("capability_missing"),
    revoke_invitation: supports("manage_access"),
    revoke_guest_grant: supports("manage_access"),
    // Intake M3 P0. Право на запись инвентаря сервер проверяет тем же
    // register_source; здесь оно только не предлагается тем, у кого его нет.
    // Пока модуль 3 выключен, поверхности нет ни у кого (A5 §4.2.2).
    register_source: !documentationEnabled
      ? unavailable("module_disabled")
      : can(input.role, "register_source")
        ? { status: "available" }
        : unavailable("capability_missing"),
    // Решение по источнику пишется через review_claim, и RPC требует именно
    // capability review_claim — предлагать действие по review_source значило бы
    // обещать то, чего сервер не разрешит.
    // Само решение уходит теперь через `projectceo_api.review_source` — тонкую
    // дверь в уже отданной схеме (миграция `20260810050000`). До неё вызов шёл
    // в `project_intelligence_api`, которую окружение намеренно не отдаёт Data
    // API, не находился PostgREST и выходил наружу как 500: это поймал AP5.
    review_source: !documentationEnabled
      ? unavailable("module_disabled")
      : can(input.role, "review_claim") && can(input.role, "review_source")
        ? pendingSourceRevisionId ? {
            status: "available",
            commandTargetId: pendingSourceRevisionId,
          } : unavailable("prerequisite_missing")
        : unavailable("capability_missing"),
    // Лист регистрируется той же властью, что публикует вход M3 — это
    // проверит и сервер (prepare_client_handoff + роль owner/architect).
    // Без опубликованного handoff команду не принять: регистрировать не от
    // чего, и предлагать её было бы обещанием отказа.
    register_documentation_sheet: !documentationEnabled
      ? unavailable("module_disabled")
      : can(input.role, "prepare_client_handoff")
        ? publishedDocumentationHandoff ? { status: "available" }
          : unavailable("prerequisite_missing")
        : unavailable("capability_missing"),
    attach_documentation_sheet_specifications: !documentationEnabled
      ? unavailable("module_disabled")
      : can(input.role, "prepare_client_handoff")
        ? hasDocumentationSheet ? { status: "available" }
          : unavailable("prerequisite_missing")
        : unavailable("capability_missing"),
    create_decision: can(input.role, "revise_decision")
      ? { status: "available" }
      : unavailable("capability_missing"),
    create_selection: can(input.role, "create_selection")
      ? { status: "available" }
      : unavailable("capability_missing"),
    create_m2_room: can(input.role, "revise_decision")
      ? { status: "available" }
      : unavailable("capability_missing"),
    create_m2_variant: can(input.role, "revise_decision")
      ? { status: "available" }
      : unavailable("capability_missing"),
    create_m2_material: can(input.role, "create_selection")
      ? { status: "available" }
      : unavailable("capability_missing"),
    set_m2_budget: can(input.role, "manage_budget")
      ? { status: "available" }
      : unavailable("capability_missing"),
    create_m2_client_handoff: can(input.role, "prepare_client_handoff")
      ? { status: "available" }
      : unavailable("capability_missing"),
    create_approval_package: can(input.role, "review_claim")
      ? { status: "available" }
      : unavailable("capability_missing"),
    submit_approval_package: can(input.role, "review_claim")
      ? hasDraftApproval ? { status: "available" } : unavailable("prerequisite_missing")
      : unavailable("capability_missing"),
    review_selection: can(input.role, "review_selection")
      ? hasSubmittedApproval ? { status: "available" } : unavailable("prerequisite_missing")
      : unavailable("capability_missing"),
    // `read_contract_pending` здесь стоял до 10.08.2026 и означал честное «мы
    // ещё не решили, откуда берётся дескриптор». Решение принято (A′): состав
    // выводит сервер, клиент возвращает только снапшот-токен, и токен —
    // `commandTargetId` этого действия.
    //
    // Ошибка сборки не роняет чтение и не превращается в обещание: если
    // замораживать нечего или встретился неизвестный вид ревизии, действие
    // просто не предлагается. Точную причину человек увидит при попытке
    // подтверждения — контролируемым отказом, а не пустым экраном.
    // Выход модуля 3 закрыт его же флагом (A5 §4.2.2). До 11.08 закрыт был
    // только приём, и публикация оставалась предложенной при выключенном
    // модуле — сильнейшая операция мимо собственного выключателя.
    publish_baseline: !documentationEnabled
      ? unavailable("module_disabled")
      : can(input.role, "publish_baseline")
        ? baselineSnapshotToken ? {
            status: "available",
            commandTargetId: baselineSnapshotToken,
          } : unavailable("prerequisite_missing")
        : unavailable("capability_missing"),
    // A′ и здесь: поверхность выдаёт токен показанного состава, команда
    // требует его назад. Без baseline или с пустым составом — честное
    // `prerequisite_missing`, а не кнопка, которую отвергнет база.
    publish_release: !documentationEnabled
      ? unavailable("module_disabled")
      : can(input.role, "publish_release")
        ? releaseSnapshotToken ? {
            status: "available",
            commandTargetId: releaseSnapshotToken,
          } : unavailable("prerequisite_missing")
        : unavailable("capability_missing"),
    distribute_release: can(input.role, "distribute_release")
      ? distributableVersionId ? {
          status: "available",
          commandTargetId: distributableVersionId,
        } : unavailable("prerequisite_missing")
      : unavailable("capability_missing"),
    acknowledge_release: can(input.role, "acknowledge_release")
      ? pendingDistribution ? {
          status: "available",
          commandTargetId: pendingDistribution.distributionId,
        } : unavailable("prerequisite_missing")
      : unavailable("capability_missing"),
    create_change: can(input.role, "create_change")
      ? changeReady ? {
          status: "available",
          commandTargetId: nullableText(
            packageVersions.find((version) => (
              nullableText(version.baselineId) && version.baselineId !== latestBaseline
            ))?.id,
          ) ?? undefined,
        } : unavailable("prerequisite_missing")
      : unavailable("capability_missing"),
    review_change_impact: can(input.role, "review_change_impact")
      ? unreviewedImpactId ? {
          status: "available",
          commandTargetId: unreviewedImpactId,
        } : unavailable("prerequisite_missing")
      : unavailable("capability_missing"),
    upload_photo_evidence: can(input.role, "upload_photo_evidence")
      ? uploadMilestoneId ? {
          status: "available",
          commandTargetId: uploadMilestoneId,
        } : unavailable("prerequisite_missing")
      : unavailable("capability_missing"),
    review_photo_evidence: can(input.role, "review_milestone")
      ? undecidedPhotoId ? {
          status: "available",
          commandTargetId: undecidedPhotoId,
        } : unavailable("prerequisite_missing")
      : unavailable("capability_missing"),
    accept_milestone: can(input.role, "review_milestone")
      ? acceptableMilestoneId ? {
          status: "available",
          commandTargetId: acceptableMilestoneId,
        } : unavailable("prerequisite_missing")
      : unavailable("capability_missing"),
    build_handover: unavailable("worker_only"),
  };
  // Guardrail модуля 4: при выключенном флаге поверхность модуля не
  // существует для пользователя. Причина именно `module_disabled`, а не
  // `capability_missing` — роль тут ни при чём, закрыт весь модуль.
  if (!executionEnabled) {
    const disabled: Record<string, ProjectCeoOperationState> = { ...states };
    for (const kind of EXECUTION_MODULE) disabled[kind] = unavailable("module_disabled");
    return disabled as ProjectCeoOperationStates;
  }
  // Модуль включён — но открыт только инкремент 1 (A6 §1.1, DEC-025) и, поверх
  // него, ревью влияния (DEC-033). Четыре команды V2/V3 не авторизованы
  // ничем, и предлагать их нельзя даже тогда, когда предпосылки для них
  // однажды появятся: сервер их отклонит (`command-service.ts`), а
  // поверхность не обещает того, чего сервер не выполнит (A6 §4.2.5).
  const authorized: Record<string, ProjectCeoOperationState> = { ...states };
  for (const kind of EXECUTION_INCREMENT_2_COMMANDS) {
    authorized[kind] = unavailable("increment_not_authorized");
  }
  return authorized as ProjectCeoOperationStates;
}

function onboarding(projectCount: number): OnboardingState {
  return {
    organizationCreated: projectCount > 0,
    projectCreated: projectCount > 0,
    scopeMode: "full_project",
    steps: [
      { id: "organization", label: copy.fixture.onboardingSteps.organization, status: projectCount ? "complete" : "current" },
      { id: "project", label: copy.fixture.onboardingSteps.project, status: projectCount ? "complete" : "pending" },
      { id: "scope", label: copy.fixture.onboardingSteps.scope, status: projectCount ? "complete" : "pending" },
      { id: "participants", label: copy.fixture.onboardingSteps.participants, status: projectCount ? "current" : "pending" },
    ],
  };
}

export class ProjectCeoLiveReadPort implements ProjectCeoUiReadPort {
  private readonly foundation: FoundationPostgresAdapter;
  private readonly authenticatedRead: ProjectCeoAuthenticatedReadPostgresAdapter;

  constructor(
    client: PostgresRpcClient,
    private readonly identity: ProjectCeoVerifiedIdentity,
  ) {
    this.foundation = new FoundationPostgresAdapter(client);
    this.authenticatedRead = new ProjectCeoAuthenticatedReadPostgresAdapter(client);
  }

  private async projectEntries(): Promise<readonly ProjectListItem[]> {
    const envelope = await this.foundation.listProjects();
    if (envelope.error || !envelope.data) {
      throw new ProjectIntelligenceAdapterError(
        envelope.error?.code ?? "internal_error",
        null,
      );
    }
    return envelope.data;
  }

  async getPortfolio(input: { readonly requestId: string }): Promise<UiEnvelope<PortfolioView>> {
    try {
      const entries = await this.projectEntries();
      if (new Set(entries.map((entry) => entry.organizationId)).size > 1) {
        throw new ProjectIntelligenceAdapterError("scope_conflict", null);
      }
      const uniqueProjectIds = [...new Set(entries.map((entry) => entry.projectId))];
      const summaries = await Promise.all(uniqueProjectIds.map(async (projectId) => {
        const scope = effectiveScope(entries, projectId)!;
        const role = roleFromDatabase(scope.role);
        const readEnvelope = await this.authenticatedRead.getProjectWorkspaceRead({
          projectId,
          packageId: scope.accessScope === "package" ? scope.packageId ?? null : null,
        });
        if (readEnvelope.error) {
          throw new ProjectIntelligenceAdapterError(readEnvelope.error.code, null);
        }
        const delivery = readEnvelope.data;
        const packages = projectPackages({ packages: delivery.packages });
        const baseline = baselineFrom(delivery);
        const releases = releaseViews(delivery, packages);
        const sourceStats = record(delivery.sourceStats);
        const projectMetadata = record(delivery.projectMetadata);
        const project: ProjectSummary = {
          id: projectId,
          organizationId: scope.organizationId,
          name: nullableText(projectMetadata.name)
            ?? packages.find((item) => item.kind === "project_root")?.name
            ?? copy.common.liveProject(projectId.slice(0, 8)),
          location: text(projectMetadata.location, copy.common.liveLocation),
          areaM2: integer(projectMetadata.areaM2),
          model: "full_project",
          stage: releases.length ? "release" : baseline.id ? "baseline" : "source_review",
          packageCount: packages.length || (scope.packageId ? 1 : 0),
          sourceStats: {
            physicalRecords: integer(sourceStats.physicalRecords),
            materializedRecords: integer(sourceStats.materializedRecords),
            placeholders: integer(sourceStats.placeholders),
            uniqueBlobs: integer(sourceStats.uniqueBlobs),
            duplicateGroups: integer(sourceStats.duplicateGroups),
            quarantinedGroups: integer(sourceStats.quarantinedGroups),
            reviewQueue: integer(sourceStats.reviewQueue),
          },
          baseline,
          latestRelease: releases.find((release) => release.status === "current") ?? null,
          openChangeCount: 0,
          participantCount: 0,
          secondProjectSignal: uniqueProjectIds.length > 1,
        };
        return { project, role };
      }));
      const firstEntry = uniqueProjectIds[0]
        ? effectiveScope(entries, uniqueProjectIds[0])
        : null;
      const firstActor = firstEntry
        ? actorFor(this.identity, firstEntry)
        : {
            actorId: this.identity.userId,
            role: "guest" as const,
            displayName: this.identity.displayName,
            projectId: "",
            packageId: null,
            capabilities: [] as const,
          };
      let access = { invitations: [] as readonly InvitationView[], participants: [] as readonly ParticipantView[], grants: [] as readonly AccessGrantView[] };
      if (firstEntry && roleFromDatabase(firstEntry.role) === "owner") {
        const envelope = await this.foundation.listProjectAccess(firstEntry.projectId);
        access = accessViews(requiredData(envelope));
      }
      return success(input.requestId, {
        organization: {
          id: firstEntry?.organizationId ?? "00000000-0000-4000-8000-000000000000",
          name: copy.common.liveOrganization,
          activeProjectCount: uniqueProjectIds.length,
          paidPilotScopeCount: 0,
        },
        actor: firstActor,
        projects: summaries.map((item) => item.project),
        onboarding: onboarding(uniqueProjectIds.length),
        invitations: access.invitations,
        grants: access.grants,
        controlledAnalytics: [],
      });
    } catch (error) {
      return failure(input.requestId, errorCode(error));
    }
  }

  async getProjectWorkspace(input: {
    readonly projectId: string;
    readonly requestId: string;
  }): Promise<UiEnvelope<ProjectWorkspaceView>> {
    try {
      const entries = await this.projectEntries();
      const scope = effectiveScope(entries, input.projectId);
      if (!scope) return failure(input.requestId, "not_found");
      const actor = actorFor(this.identity, scope);
      const readEnvelope = await this.authenticatedRead.getProjectWorkspaceRead({
        projectId: input.projectId,
        packageId: scope.accessScope === "package" ? scope.packageId ?? null : null,
      });
      if (readEnvelope.error) {
        throw new ProjectIntelligenceAdapterError(readEnvelope.error.code, null);
      }
      const delivery = readEnvelope.data;
      const packages = projectPackages({ packages: delivery.packages });
      const sources = sourceViews(delivery.sources);
      const baseline = baselineFrom(delivery);
      const releases = releaseViews(delivery, packages);
      const m4Envelopes = delivery.executionPackages;
      const execution = m4Views(m4Envelopes);
      const m2 = m2WorkspaceViews(delivery);
      const m2Cycle6 = m2Cycle6Views(delivery);
      let access = { invitations: [] as readonly InvitationView[], participants: [] as readonly ParticipantView[], grants: [] as readonly AccessGrantView[] };
      if (can(actor.role, "manage_access")) {
        const envelope = await this.foundation.listProjectAccess(input.projectId);
        access = accessViews(requiredData(envelope));
      }
      const projectedRecipients = releaseRecipientViews(delivery.releaseRecipients);
      if (projectedRecipients.length > 0) {
        const participants = new Map(
          access.participants.map((participant) => [participant.id, participant]),
        );
        for (const participant of projectedRecipients) {
          participants.set(participant.id, participant);
        }
        access = { ...access, participants: [...participants.values()] };
      }
      const historyEnvelope = can(actor.role, "view_audit")
        ? await this.foundation.getAuditTimeline(input.projectId)
        : null;
      const sourceStats = record(delivery.sourceStats);
      const projectMetadata = record(delivery.projectMetadata);
      const project: ProjectSummary = {
        id: input.projectId,
        organizationId: scope.organizationId,
        name: nullableText(projectMetadata.name)
          ?? packages.find((item) => item.kind === "project_root")?.name
          ?? copy.common.liveProject(input.projectId.slice(0, 8)),
        location: text(projectMetadata.location, copy.common.liveLocation),
        areaM2: integer(projectMetadata.areaM2),
        model: "full_project",
        stage: execution.changes.length ? "change" : releases.length ? "release" : baseline.id ? "baseline" : "source_review",
        packageCount: packages.length,
        sourceStats: {
          physicalRecords: integer(sourceStats.physicalRecords),
          materializedRecords: integer(sourceStats.materializedRecords),
          placeholders: integer(sourceStats.placeholders),
          uniqueBlobs: integer(sourceStats.uniqueBlobs),
          duplicateGroups: integer(sourceStats.duplicateGroups),
          quarantinedGroups: integer(sourceStats.quarantinedGroups),
          reviewQueue: integer(sourceStats.reviewQueue),
        },
        baseline,
        latestRelease: releases.find((release) => release.status === "current") ?? null,
        openChangeCount: execution.changes.filter((change) => change.status !== "released").length,
        participantCount: access.participants.length,
        secondProjectSignal: new Set(entries.map((entry) => entry.projectId)).size > 1,
      };
      return success(input.requestId, {
        project,
        actor,
        packages,
        sources,
        decisions: decisionViews(delivery.decisions),
        selections: selectionViews(delivery.selections),
        approvalPackages: approvalPackageViews(delivery.approvalPackages),
        m2Rooms: m2.rooms,
        m2Variants: m2.variants,
        m2Materials: m2.materials,
        m2BudgetFrames: m2.budgets,
        m2ClientHandoffs: m2.handoffs,
        m2ClientReviewSubmissions: m2Cycle6.m2ClientReviewSubmissions,
        m2ClientReviews: m2Cycle6.m2ClientReviews,
        m2M3Handoffs: m2Cycle6.m2M3Handoffs,
        m2ApprovedCommits: m2Cycle6.m2ApprovedCommits,
        m2LayoutVersions: m2Cycle6.m2LayoutVersions,
        baseline,
        releases,
        changes: execution.changes,
        participants: access.participants,
        invitations: access.invitations,
        grants: access.grants,
        milestones: execution.milestones,
        handover: execution.handover,
        history: historyViews(historyEnvelope ? requiredData(historyEnvelope) : null),
        controlledAnalytics: [],
        documentation: documentationView({
          delivery,
          enabled: isDocumentationModuleEnabled(),
        }),
        operations: operationStates({
          role: actor.role,
          delivery,
          m4: m4Envelopes,
        }),
      });
    } catch (error) {
      return failure(input.requestId, errorCode(error));
    }
  }
}
