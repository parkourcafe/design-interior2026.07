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
  type ChangeRequestView,
  type DecisionView,
  type EvidenceView,
  type InvitationView,
  type OnboardingState,
  type ParticipantView,
  type PhotoMilestoneView,
  type PortfolioView,
  type ProjectCeoActor,
  type ProjectCeoOperationState,
  type ProjectCeoOperationStates,
  type ProjectCeoRole,
  type ProjectPackageView,
  type ProjectSummary,
  type ProjectWorkspaceView,
  type ReleaseSummary,
  type SelectionView,
  type SourceRegistryItem,
  type UiEnvelope,
  type UiError,
} from "@/components/projectceo/contracts";
import type { ProjectCeoUiReadPort } from "@/components/projectceo/port";
import { capabilitiesForRole, can } from "@/components/projectceo/role-policy";
import { ru } from "@/lib/i18n/ru";
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

function operationStates(input: {
  readonly role: ProjectCeoRole;
  readonly delivery: AuthenticatedProjectReadProjection;
  readonly m4: readonly ExecutionDeliveryEnvelope[];
}): ProjectCeoOperationStates {
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
  return {
    create_invitation: can(input.role, "manage_access")
      ? { status: "available" }
      : unavailable("capability_missing"),
    revoke_invitation: supports("manage_access"),
    revoke_guest_grant: supports("manage_access"),
    register_source: unavailable("read_contract_pending"),
    review_source: unavailable("read_contract_pending"),
    create_decision: can(input.role, "revise_decision")
      ? { status: "available" }
      : unavailable("capability_missing"),
    create_selection: can(input.role, "create_selection")
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
    publish_baseline: unavailable("read_contract_pending"),
    publish_release: unavailable("read_contract_pending"),
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
      const delivery = readEnvelope.data;
      const packages = projectPackages({ packages: delivery.packages });
      const sources = sourceViews(delivery.sources);
      const baseline = baselineFrom(delivery);
      const releases = releaseViews(delivery, packages);
      const m4Envelopes = delivery.executionPackages;
      const execution = m4Views(m4Envelopes);
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
