import {
  PROJECTCEO_UI_CONTRACT_VERSION,
  type AccessGrantView,
  type AnalyticsEvent,
  type ApprovalPackageView,
  type AuditEventView,
  type BaselineSummary,
  type ChangeRequestView,
  type M2BudgetFrameView,
  type M2ClientHandoffView,
  type M2MaterialView,
  type M2RoomView,
  type M2VariantView,
  type DecisionView,
  type InvitationView,
  type OnboardingState,
  type ParticipantView,
  type PhotoMilestoneView,
  type PortfolioView,
  type ProjectCeoOperationStates,
  type ProjectCeoActor,
  type ProjectCeoRole,
  type ProjectPackageView,
  type ProjectSummary,
  type ProjectWorkspaceView,
  type ReleaseSummary,
  type SelectionView,
  type SourceRegistryItem,
  type UiEnvelope,
} from "./contracts";
import { ru } from "@/lib/i18n/ru";
import type { ProjectCeoUiReadPort } from "./port";
import {
  assertExactPackageScope,
  capabilitiesForRole,
} from "./role-policy";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
export const KORA_PROJECT_ID = "kora-food-hall";
export const KORA_ROOT_PACKAGE_ID = "kora-project-root";
export const KORA_ARCHITECTURE_PACKAGE_ID = "kora-architecture-release";
const fixtureRu = ru.projectCeo.fixture;

const fixtureOperations: ProjectCeoOperationStates = {
  create_invitation: { status: "unavailable", reason: "fixture_read_only" },
  revoke_invitation: { status: "unavailable", reason: "fixture_read_only" },
  revoke_guest_grant: { status: "unavailable", reason: "fixture_read_only" },
  register_source: { status: "unavailable", reason: "fixture_read_only" },
  review_source: { status: "unavailable", reason: "fixture_read_only" },
  register_documentation_sheet: { status: "unavailable", reason: "fixture_read_only" },
  attach_documentation_sheet_specifications: { status: "unavailable", reason: "fixture_read_only" },
  review_selection: { status: "unavailable", reason: "fixture_read_only" },
  create_decision: { status: "unavailable", reason: "fixture_read_only" },
  create_selection: { status: "unavailable", reason: "fixture_read_only" },
  create_approval_package: { status: "unavailable", reason: "fixture_read_only" },
  submit_approval_package: { status: "unavailable", reason: "fixture_read_only" },
  create_m2_room: { status: "unavailable", reason: "fixture_read_only" },
  create_m2_variant: { status: "unavailable", reason: "fixture_read_only" },
  create_m2_material: { status: "unavailable", reason: "fixture_read_only" },
  set_m2_budget: { status: "unavailable", reason: "fixture_read_only" },
  create_m2_client_handoff: { status: "unavailable", reason: "fixture_read_only" },
  publish_baseline: { status: "unavailable", reason: "fixture_read_only" },
  publish_release: { status: "unavailable", reason: "fixture_read_only" },
  distribute_release: { status: "unavailable", reason: "fixture_read_only" },
  acknowledge_release: { status: "unavailable", reason: "fixture_read_only" },
  create_change: { status: "unavailable", reason: "fixture_read_only" },
  review_change_impact: { status: "unavailable", reason: "fixture_read_only" },
  acknowledge_impact_truncation: { status: "unavailable", reason: "fixture_read_only" },
  upload_photo_evidence: { status: "unavailable", reason: "fixture_read_only" },
  review_photo_evidence: { status: "unavailable", reason: "fixture_read_only" },
  accept_milestone: { status: "unavailable", reason: "fixture_read_only" },
  build_handover: { status: "unavailable", reason: "fixture_read_only" },
};

function semanticHash(character: string): `sha256:${string}` {
  return `sha256:${character.repeat(64)}`;
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

function actorFor(role: ProjectCeoRole, projectId: string): ProjectCeoActor {
  return {
    actorId: `actor-${role}`,
    role,
    displayName: fixtureRu.actorNames[role],
    projectId,
    packageId: role === "guest" ? KORA_ARCHITECTURE_PACKAGE_ID : null,
    capabilities: capabilitiesForRole(role),
  };
}

const koraBaseline: BaselineSummary = {
  id: "baseline-kora-v2",
  versionNo: 2,
  status: "published",
  blockerCount: 0,
  semanticHash: semanticHash("b"),
  publishedAt: "2026-07-17T09:20:00Z",
};

const koraCurrentRelease: ReleaseSummary = {
  id: "release-kora-architecture-v2",
  packageId: KORA_ARCHITECTURE_PACKAGE_ID,
  packageName: fixtureRu.packages.architecture,
  versionNo: 2,
  status: "current",
  semanticHash: semanticHash("c"),
  distributionStatus: "partially_acknowledged",
  acknowledgementCount: 3,
  recipientCount: 4,
  publishedAt: "2026-07-17T09:35:00Z",
  pendingDistributionId: null,
};

const koraSummary: ProjectSummary = {
  id: KORA_PROJECT_ID,
  organizationId: ORGANIZATION_ID,
  name: fixtureRu.kora.name,
  location: fixtureRu.kora.location,
  areaM2: 1800,
  model: "full_project",
  stage: "change",
  packageCount: 5,
  sourceStats: {
    physicalRecords: 209,
    materializedRecords: 81,
    placeholders: 128,
    uniqueBlobs: 28,
    duplicateGroups: 18,
    quarantinedGroups: 8,
    reviewQueue: 11,
  },
  baseline: koraBaseline,
  latestRelease: koraCurrentRelease,
  openChangeCount: 1,
  participantCount: 7,
  secondProjectSignal: true,
};

const koraGuestSummary: ProjectSummary = {
  ...koraSummary,
  areaM2: 0,
  stage: "release",
  packageCount: 1,
  sourceStats: {
    physicalRecords: 0,
    materializedRecords: 0,
    placeholders: 0,
    uniqueBlobs: 0,
    duplicateGroups: 0,
    quarantinedGroups: 0,
    reviewQueue: 0,
  },
  openChangeCount: 0,
  participantCount: 0,
  secondProjectSignal: false,
};

const otherProjects: readonly ProjectSummary[] = [
  {
    id: "pilot-residence-002",
    organizationId: ORGANIZATION_ID,
    name: fixtureRu.otherProjects.residence,
    location: fixtureRu.otherProjects.location,
    areaM2: 164,
    model: "full_project",
    stage: "baseline",
    packageCount: 3,
    sourceStats: {
      physicalRecords: 46,
      materializedRecords: 42,
      placeholders: 4,
      uniqueBlobs: 39,
      duplicateGroups: 3,
      quarantinedGroups: 1,
      reviewQueue: 4,
    },
    baseline: {
      id: null,
      versionNo: 0,
      status: "ready",
      blockerCount: 0,
      semanticHash: null,
      publishedAt: null,
    },
    latestRelease: null,
    openChangeCount: 0,
    participantCount: 4,
    secondProjectSignal: true,
  },
  {
    id: "pilot-renovation-003",
    organizationId: ORGANIZATION_ID,
    name: fixtureRu.otherProjects.renovation,
    location: fixtureRu.otherProjects.location,
    areaM2: 420,
    model: "full_project",
    stage: "source_review",
    packageCount: 4,
    sourceStats: {
      physicalRecords: 78,
      materializedRecords: 62,
      placeholders: 16,
      uniqueBlobs: 58,
      duplicateGroups: 4,
      quarantinedGroups: 2,
      reviewQueue: 9,
    },
    baseline: {
      id: null,
      versionNo: 0,
      status: "blocked",
      blockerCount: 5,
      semanticHash: null,
      publishedAt: null,
    },
    latestRelease: null,
    openChangeCount: 0,
    participantCount: 5,
    secondProjectSignal: false,
  },
];

const onboarding: OnboardingState = {
  organizationCreated: true,
  projectCreated: true,
  scopeMode: "full_project",
  steps: [
    { id: "organization", label: fixtureRu.onboardingSteps.organization, status: "complete" },
    { id: "project", label: fixtureRu.onboardingSteps.project, status: "complete" },
    { id: "scope", label: fixtureRu.onboardingSteps.scope, status: "complete" },
    { id: "participants", label: fixtureRu.onboardingSteps.participants, status: "current" },
  ],
};

const packages: readonly ProjectPackageView[] = [
  {
    id: KORA_ROOT_PACKAGE_ID,
    name: fixtureRu.packages.root,
    kind: "project_root",
    status: "active",
    exactScope: true,
  },
  {
    id: KORA_ARCHITECTURE_PACKAGE_ID,
    name: fixtureRu.packages.architecture,
    kind: "work_package",
    status: "active",
    exactScope: true,
  },
  {
    id: "kora-engineering-release",
    name: fixtureRu.packages.engineering,
    kind: "work_package",
    status: "active",
    exactScope: true,
  },
  {
    id: "kora-project-controls",
    name: fixtureRu.packages.controls,
    kind: "work_package",
    status: "active",
    exactScope: true,
  },
  {
    id: "kora-site-evidence",
    name: fixtureRu.packages.evidence,
    kind: "work_package",
    status: "active",
    exactScope: true,
  },
];

function sourceAt(index: number): SourceRegistryItem {
  const materialized = index < 81;
  const semanticConflict = index < 8;
  const mediaKind = index % 17 === 0
    ? "cad_binary"
    : index % 19 === 0
      ? "archive"
      : index % 11 === 0
        ? "spreadsheet"
        : index % 5 === 0
          ? "image"
          : "pdf";
  const quarantine = semanticConflict
    ? "semantic_conflict"
    : mediaKind === "cad_binary" || mediaKind === "archive"
      ? "preview_required"
      : null;
  return {
    id: `source-record-${String(index + 1).padStart(3, "0")}`,
    sourceRevisionId: materialized
      ? `source-revision-${String(index + 1).padStart(3, "0")}`
      : null,
    reviewTargetRevisionId: materialized
      ? `source-revision-${String(index + 1).padStart(3, "0")}`
      : null,
    displayCode: `SRC-${String(index + 1).padStart(3, "0")}`,
    packageId: index % 4 === 0 ? "kora-engineering-release" : KORA_ARCHITECTURE_PACKAGE_ID,
    floor: fixtureRu.source.floors[index % fixtureRu.source.floors.length]!,
    zone: fixtureRu.source.zones[index % fixtureRu.source.zones.length]!,
    discipline: fixtureRu.source.disciplines[index % fixtureRu.source.disciplines.length]!,
    mediaKind,
    availability: materialized ? "materialized" : "placeholder",
    documentStatus: index < 62 ? "current" : index < 79 ? "previous" : index < 199 ? "reference" : "unknown",
    checksumShort: materialized ? `sha256:${String(index % 28).padStart(2, "0")}…` : null,
    duplicateAliasCount: materialized && index < 72 ? 3 : 0,
    quarantine,
    evidenceEligible: materialized && quarantine === null,
    reviewStatus: semanticConflict ? "clarification_requested" : index % 9 === 0 ? "pending" : "confirmed",
  };
}

const sources = Array.from({ length: 209 }, (_, index) => sourceAt(index));

const evidence = [
  {
    evidenceId: "evidence-selection-floor-r2",
    sourceCode: "SRC-014",
    sourceRevision: "source-revision-014",
    locatorLabel: fixtureRu.decisions.floorLocator,
  },
] as const;

const decisions: readonly DecisionView[] = [
  {
    id: "decision-floor-finish",
    packageId: KORA_ARCHITECTURE_PACKAGE_ID,
    areaNodeId: "area-kitchen",
    title: fixtureRu.decisions.floorTitle,
    resolution: fixtureRu.decisions.floorResolution,
    revisionId: "decision-floor-finish-r2",
    revisionNo: 2,
    claimStatus: "human_origin",
    reviewStatus: "approved",
    evidence,
  },
  {
    id: "decision-egress",
    packageId: KORA_ARCHITECTURE_PACKAGE_ID,
    areaNodeId: "area-kitchen",
    title: fixtureRu.decisions.egressTitle,
    resolution: fixtureRu.decisions.egressResolution,
    revisionId: "decision-egress-r1",
    revisionNo: 1,
    claimStatus: "interpreted",
    reviewStatus: "submitted",
    evidence: [{
      evidenceId: "evidence-egress-r1",
      sourceCode: "SRC-031",
      sourceRevision: "source-revision-031",
      locatorLabel: fixtureRu.decisions.egressLocator,
    }],
  },
];

const selections: readonly SelectionView[] = [
  {
    id: "selection-floor-finish",
    title: fixtureRu.selection.title,
    area: fixtureRu.selection.area,
    packageId: KORA_ARCHITECTURE_PACKAGE_ID,
    areaNodeId: "area-kitchen",
    revisionNo: 2,
    revisionId: "selection-floor-finish-r2",
    decisionRevisionId: "decision-floor-finish-r2",
    reviewStatus: "submitted",
    specification: fixtureRu.selection.specification.map(([label, value]) => ({
      label,
      value,
    })),
    priceObservation: {
      amountRub: 1_480_000,
      checkedAt: "2026-07-16T08:00:00Z",
      sourceCode: "SRC-087",
    },
    evidence,
    revisionHistory: [
      {
        revisionNo: 2,
        revisionId: "selection-floor-finish-r2",
        reason: fixtureRu.selection.currentReason,
        status: "current",
      },
      {
        revisionNo: 1,
        revisionId: "selection-floor-finish-r1",
        reason: fixtureRu.selection.previousReason,
        status: "superseded",
      },
    ],
  },
];

const approvalPackages: readonly ApprovalPackageView[] = [];
const m2Rooms: readonly M2RoomView[] = [];
const m2Variants: readonly M2VariantView[] = [];
const m2Materials: readonly M2MaterialView[] = [];
const m2BudgetFrames: readonly M2BudgetFrameView[] = [];
const m2ClientHandoffs: readonly M2ClientHandoffView[] = [];

const releases: readonly ReleaseSummary[] = [
  koraCurrentRelease,
  {
    id: "release-kora-architecture-v1",
    packageId: KORA_ARCHITECTURE_PACKAGE_ID,
    packageName: fixtureRu.packages.architecture,
    versionNo: 1,
    status: "superseded",
    semanticHash: semanticHash("a"),
    distributionStatus: "acknowledged",
    acknowledgementCount: 4,
    recipientCount: 4,
    publishedAt: "2026-07-15T11:00:00Z",
    pendingDistributionId: null,
  },
];

const changes: readonly ChangeRequestView[] = [
  {
    id: "change-request-floor-finish",
    title: fixtureRu.change.title,
    status: "impact_review",
    fromBaseline: fixtureRu.change.fromBaseline,
    toBaseline: fixtureRu.change.toBaseline,
    deltaRub: 180_000,
    deltaDays: 2,
    requestedAt: "2026-07-16T12:00:00Z",
    impactCount: 3,
    reviewedImpactCount: 2,
    impactRunId: null,
    impactTruncated: false,
    impactTruncationReason: null,
    impactTruncationAcknowledged: false,
    impactCalculatedDepth: null,
    impactPolicyMaxDepth: null,
    impactReviewComplete: false,
    reason: fixtureRu.change.reason,
    impacts: [
      {
        impactRunId: "88888888-8888-4888-8888-888888888888",
        impactId: "impact-floor-finish",
        label: fixtureRu.change.impactLabels.finish,
        disposition: "accepted",
      },
      {
        impactRunId: "88888888-8888-4888-8888-888888888888",
        impactId: "impact-budget",
        label: fixtureRu.change.impactLabels.budget,
        disposition: "resolved",
      },
      {
        impactRunId: "88888888-8888-4888-8888-888888888888",
        impactId: "impact-schedule",
        label: fixtureRu.change.impactLabels.schedule,
        disposition: null,
      },
    ],
  },
];

const participants: readonly ParticipantView[] = [
  { id: "participant-owner", displayName: fixtureRu.actorNames.owner, role: "owner", scopeLabel: fixtureRu.participants.ownerScope, status: "active" },
  { id: "participant-architect", displayName: fixtureRu.actorNames.architect, role: "architect", scopeLabel: fixtureRu.participants.ownerScope, status: "active" },
  { id: "participant-builder", displayName: fixtureRu.actorNames.builder, role: "builder", scopeLabel: fixtureRu.participants.builderScope, status: "active" },
  { id: "participant-client", displayName: fixtureRu.actorNames.client, role: "client", scopeLabel: fixtureRu.participants.clientScope, status: "active" },
  { id: "participant-guest", displayName: fixtureRu.actorNames.guest, role: "guest", scopeLabel: fixtureRu.participants.guestScope, status: "active" },
];

const invitations: readonly InvitationView[] = [
  {
    id: "invitation-architect",
    recipientLabel: "a•••@studio.example",
    role: "architect",
    scopeLabel: fixtureRu.invitationScopes.project,
    status: "accepted",
    expiresAt: "2026-07-21T12:00:00Z",
    shareUrl: null,
  },
  {
    id: "invitation-builder",
    recipientLabel: "b•••@contractor.example",
    role: "builder",
    scopeLabel: fixtureRu.invitationScopes.published,
    status: "pending",
    expiresAt: "2026-07-21T12:00:00Z",
    shareUrl: "https://projectceo.example/invite/sanitized-builder-demo",
  },
  {
    id: "invitation-expired",
    recipientLabel: "c•••@client.example",
    role: "client",
    scopeLabel: fixtureRu.invitationScopes.approval,
    status: "expired",
    expiresAt: "2026-07-16T12:00:00Z",
    shareUrl: null,
  },
  {
    id: "invitation-revoked",
    recipientLabel: "p•••@partner.example",
    role: "builder",
    scopeLabel: fixtureRu.invitationScopes.archived,
    status: "revoked",
    expiresAt: "2026-07-20T12:00:00Z",
    shareUrl: null,
  },
];

const grants: readonly AccessGrantView[] = [
  {
    id: "grant-architecture-v2",
    label: fixtureRu.grants.active,
    packageId: KORA_ARCHITECTURE_PACKAGE_ID,
    releaseId: koraCurrentRelease.id,
    status: "active",
    expiresAt: "2026-07-20T09:35:00Z",
    canAcknowledge: true,
    shareUrl: "https://projectceo.example/access/sanitized-release-demo",
  },
  {
    id: "grant-revoked",
    label: fixtureRu.grants.revoked,
    packageId: KORA_ARCHITECTURE_PACKAGE_ID,
    releaseId: releases[1]!.id,
    status: "revoked",
    expiresAt: "2026-07-18T09:35:00Z",
    canAcknowledge: false,
    shareUrl: null,
  },
  {
    id: "grant-expired",
    label: fixtureRu.grants.expired,
    packageId: KORA_ARCHITECTURE_PACKAGE_ID,
    releaseId: releases[1]!.id,
    status: "expired",
    expiresAt: "2026-07-16T09:35:00Z",
    canAcknowledge: false,
    shareUrl: null,
  },
];

const milestones: readonly PhotoMilestoneView[] = [
  {
    id: "milestone-first-floor-rough-in",
    packageId: KORA_ARCHITECTURE_PACKAGE_ID,
    area: fixtureRu.milestones.firstArea,
    milestone: fixtureRu.milestones.first,
    photoCount: 12,
    status: "accepted",
    submittedAt: "2026-07-16T10:00:00Z",
    areas: [{
      areaNodeId: "area-first-floor",
      photos: [{
        id: "photo-first-floor-1",
        capturedAt: "2026-07-16T10:00:00Z",
        decision: "accepted",
      }],
    }],
  },
  {
    id: "milestone-second-floor-finish",
    packageId: KORA_ARCHITECTURE_PACKAGE_ID,
    area: fixtureRu.milestones.secondArea,
    milestone: fixtureRu.milestones.second,
    photoCount: 8,
    status: "submitted",
    submittedAt: "2026-07-17T07:30:00Z",
    areas: [{
      areaNodeId: "area-second-floor",
      photos: [{
        id: "photo-second-floor-1",
        capturedAt: "2026-07-17T07:30:00Z",
        decision: null,
      }],
    }],
  },
];

const history: readonly AuditEventView[] = [
  {
    id: "audit-release-v2",
    event: fixtureRu.history.release,
    actorRole: "architect",
    occurredAt: "2026-07-17T09:35:00Z",
    controlledDetail: fixtureRu.history.releaseDetail,
  },
  {
    id: "audit-impact-reviewed",
    event: fixtureRu.history.impact,
    actorRole: "owner",
    occurredAt: "2026-07-17T09:10:00Z",
    controlledDetail: fixtureRu.history.impactDetail,
  },
  {
    id: "audit-source-review",
    event: fixtureRu.history.source,
    actorRole: "architect",
    occurredAt: "2026-07-17T08:45:00Z",
    controlledDetail: fixtureRu.history.sourceDetail,
  },
  {
    id: "audit-extraction",
    event: fixtureRu.history.extraction,
    actorRole: "system",
    occurredAt: "2026-07-17T08:30:00Z",
    controlledDetail: fixtureRu.history.extractionDetail,
  },
];

const analytics: readonly AnalyticsEvent[] = [
  { name: "organization_created", projectId: null, packageId: null, occurredAt: "2026-07-14T09:00:00Z" },
  { name: "project_created", projectId: KORA_PROJECT_ID, packageId: null, occurredAt: "2026-07-14T09:05:00Z" },
  { name: "source_registered", projectId: KORA_PROJECT_ID, packageId: null, occurredAt: "2026-07-14T10:00:00Z" },
  { name: "baseline_published", projectId: KORA_PROJECT_ID, packageId: null, occurredAt: "2026-07-17T09:20:00Z" },
  { name: "release_published", projectId: KORA_PROJECT_ID, packageId: KORA_ARCHITECTURE_PACKAGE_ID, occurredAt: "2026-07-17T09:35:00Z" },
  { name: "change_requested", projectId: KORA_PROJECT_ID, packageId: KORA_ARCHITECTURE_PACKAGE_ID, occurredAt: "2026-07-16T12:00:00Z" },
  { name: "second_project_started", projectId: "pilot-residence-002", packageId: null, occurredAt: "2026-07-17T10:00:00Z" },
];

function roleScopedWorkspace(role: ProjectCeoRole): ProjectWorkspaceView {
  const actor = actorFor(role, KORA_PROJECT_ID);
  const isCore = role === "owner" || role === "architect";
  const isGuest = role === "guest";
  return {
    project: isGuest ? koraGuestSummary : koraSummary,
    actor,
    packages: isGuest
      ? packages.filter((item) => item.id === KORA_ARCHITECTURE_PACKAGE_ID)
      : packages,
    sources: isCore ? sources : [],
    decisions: isGuest ? [] : decisions,
    selections: isGuest ? [] : selections,
    approvalPackages: isGuest ? [] : approvalPackages,
    m2Rooms: isGuest ? [] : m2Rooms,
    m2Variants: isGuest ? [] : m2Variants,
    m2Materials: isGuest ? [] : m2Materials,
    m2BudgetFrames: isGuest ? [] : m2BudgetFrames,
    m2ClientHandoffs: isGuest ? [] : m2ClientHandoffs,
    m2ClientReviewSubmissions: [],
    m2ClientReviews: [],
    m2M3Handoffs: [],
    m2ApprovedCommits: [],
    m2LayoutVersions: [],
    baseline: koraBaseline,
    releases: isGuest
      ? releases.filter((release) => release.packageId === actor.packageId && release.status === "current")
      : releases,
    changes: isGuest ? [] : changes,
    participants: role === "owner" ? participants : [],
    invitations: role === "owner" ? invitations : [],
    grants: role === "owner" ? grants : [],
    milestones: role === "owner" || role === "architect" || role === "builder" || role === "client"
      ? milestones
      : [],
    handover: isGuest
      ? {
          status: "not_ready",
          acceptedAreaCount: 0,
          totalAreaCount: 0,
          warrantyDocumentCount: 0,
          archiveHash: null,
        }
      : {
          status: "not_ready",
          acceptedAreaCount: 1,
          totalAreaCount: 2,
          warrantyDocumentCount: 4,
          archiveHash: null,
        },
    history: isCore ? history : [],
    // The deterministic Kora fixture stops at M2: it carries no documentation
    // package, so the section is absent rather than present-and-empty.
    documentation: null,
    controlledAnalytics: isCore ? analytics : [],
    operations: fixtureOperations,
  };
}

function success<T>(requestId: string, data: T): UiEnvelope<T> {
  return immutable({
    contractVersion: PROJECTCEO_UI_CONTRACT_VERSION,
    requestId,
    data,
    error: null,
  });
}

function failure<T>(
  requestId: string,
  code: "not_found" | "scope_conflict",
  messageKey: string,
): UiEnvelope<T> {
  return immutable({
    contractVersion: PROJECTCEO_UI_CONTRACT_VERSION,
    requestId,
    data: null,
    error: { code, messageKey, retryable: false },
  });
}

export function createProjectCeoMockPort(
  role: ProjectCeoRole = "owner",
): ProjectCeoUiReadPort {
  return {
    async getPortfolio({ requestId }) {
      const portfolio: PortfolioView = {
        organization: {
          id: ORGANIZATION_ID,
          name: fixtureRu.organizationName,
          activeProjectCount: 3,
          paidPilotScopeCount: 3,
        },
        actor: actorFor(role, KORA_PROJECT_ID),
        projects: role === "guest" ? [koraGuestSummary] : [koraSummary, ...otherProjects],
        onboarding,
        invitations: role === "owner" ? invitations : [],
        grants: role === "owner" ? grants : [],
        controlledAnalytics: role === "owner" || role === "architect" ? analytics : [],
      };
      return success(requestId, portfolio);
    },

    async getProjectWorkspace({ projectId, requestId }) {
      if (projectId !== KORA_PROJECT_ID) {
        return failure(requestId, "not_found", "project_not_found");
      }
      const actor = actorFor(role, projectId);
      const packageId = actor.packageId;
      if (!assertExactPackageScope({
        role,
        actorPackageId: actor.packageId,
        requestedPackageId: packageId,
      })) {
        return failure(requestId, "scope_conflict", "exact_package_scope_required");
      }
      return success(requestId, roleScopedWorkspace(role));
    },
  };
}
