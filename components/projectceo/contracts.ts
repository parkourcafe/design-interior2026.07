export const PROJECTCEO_UI_CONTRACT_VERSION = "projectceo-ui/0.1" as const;

export const PROJECTCEO_ROLES = [
  "owner",
  "architect",
  "builder",
  "client",
  "guest",
] as const;

export type ProjectCeoRole = (typeof PROJECTCEO_ROLES)[number];

export const PROJECTCEO_CAPABILITIES = [
  "view_project",
  "manage_project",
  "manage_access",
  "register_source",
  "review_source",
  "review_claim",
  "create_selection",
  "review_selection",
  "publish_baseline",
  "publish_release",
  "distribute_release",
  "acknowledge_release",
  "revise_decision",
  "create_change",
  "review_change_impact",
  "upload_photo_evidence",
  "review_milestone",
  "view_audit",
] as const;

export type ProjectCeoCapability = (typeof PROJECTCEO_CAPABILITIES)[number];

export const PROJECTCEO_TABS = [
  "overview",
  "sources",
  "decisions",
  "baseline",
  "releases",
  "changes",
  "participants",
  "history",
] as const;

export type ProjectCeoTab = (typeof PROJECTCEO_TABS)[number];

export const UI_SCENARIOS = [
  "ready",
  "loading",
  "empty",
  "error",
  "stale",
  "revoked",
  "expired",
] as const;

export type UiScenario = (typeof UI_SCENARIOS)[number];

export type FoundationErrorCode =
  | "unauthenticated"
  | "identity_unverified"
  | "forbidden"
  | "not_found"
  | "expired"
  | "revoked"
  | "stale_state"
  | "idempotency_conflict"
  | "scope_conflict"
  | "unsupported_source"
  | "validation_failed"
  | "rate_limited"
  | "internal_error";

export interface UiError {
  readonly code: FoundationErrorCode;
  readonly messageKey: string;
  readonly retryable: boolean;
}

export interface UiEnvelope<T> {
  readonly contractVersion: typeof PROJECTCEO_UI_CONTRACT_VERSION;
  readonly requestId: string;
  readonly data: T | null;
  readonly error: UiError | null;
}

export interface ProjectCeoActor {
  readonly actorId: string;
  readonly role: ProjectCeoRole;
  readonly displayName: string;
  readonly projectId: string;
  readonly packageId: string | null;
  readonly capabilities: readonly ProjectCeoCapability[];
}

export interface OrganizationSummary {
  readonly id: string;
  readonly name: string;
  readonly activeProjectCount: number;
  readonly paidPilotScopeCount: number;
}

export interface SourceStats {
  readonly physicalRecords: number;
  readonly materializedRecords: number;
  readonly placeholders: number;
  readonly uniqueBlobs: number;
  readonly duplicateGroups: number;
  readonly quarantinedGroups: number;
  readonly reviewQueue: number;
}

export interface BaselineSummary {
  readonly id: string | null;
  readonly versionNo: number;
  readonly status: "draft" | "blocked" | "ready" | "published";
  readonly blockerCount: number;
  readonly semanticHash: `sha256:${string}` | null;
  readonly publishedAt: string | null;
}

export interface ReleaseSummary {
  readonly id: string;
  readonly packageId: string;
  readonly packageName: string;
  readonly versionNo: number;
  readonly status: "current" | "superseded";
  readonly semanticHash: `sha256:${string}`;
  readonly distributionStatus: "draft" | "distributed" | "partially_acknowledged" | "acknowledged";
  readonly acknowledgementCount: number;
  readonly recipientCount: number;
  readonly publishedAt: string;
  readonly pendingDistributionId: string | null;
}

export interface ProjectSummary {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly location: string;
  readonly areaM2: number;
  readonly model: "full_project";
  readonly stage: "source_review" | "baseline" | "release" | "change";
  readonly packageCount: number;
  readonly sourceStats: SourceStats;
  readonly baseline: BaselineSummary;
  readonly latestRelease: ReleaseSummary | null;
  readonly openChangeCount: number;
  readonly participantCount: number;
  readonly secondProjectSignal: boolean;
}

export interface PortfolioView {
  readonly organization: OrganizationSummary;
  readonly actor: ProjectCeoActor;
  readonly projects: readonly ProjectSummary[];
  readonly onboarding: OnboardingState;
  readonly invitations: readonly InvitationView[];
  readonly grants: readonly AccessGrantView[];
  readonly controlledAnalytics: readonly AnalyticsEvent[];
}

export interface ProjectPackageView {
  readonly id: string;
  readonly name: string;
  readonly kind: "project_root" | "work_package";
  readonly status: "active" | "archived";
  readonly exactScope: boolean;
}

export interface SourceRegistryItem {
  readonly id: string;
  readonly sourceRevisionId: string | null;
  readonly displayCode: string;
  readonly packageId: string;
  readonly floor: string;
  readonly zone: string;
  readonly discipline: string;
  readonly mediaKind: "pdf" | "image" | "spreadsheet" | "plain_text" | "document" | "cad_binary" | "archive";
  readonly availability: "materialized" | "placeholder";
  readonly documentStatus: "current" | "previous" | "reference" | "unknown";
  readonly checksumShort: string | null;
  readonly duplicateAliasCount: number;
  readonly quarantine: "semantic_conflict" | "preview_required" | "extraction_required" | null;
  readonly evidenceEligible: boolean;
  readonly reviewStatus: "pending" | "confirmed" | "rejected" | "clarification_requested";
}

export interface EvidenceView {
  readonly evidenceId: string;
  readonly sourceCode: string;
  readonly sourceRevision: string;
  readonly locatorLabel: string;
}

export interface SelectionView {
  readonly id: string;
  readonly title: string;
  readonly area: string;
  readonly packageId: string;
  readonly revisionNo: number;
  readonly revisionId: string;
  readonly decisionRevisionId: string;
  readonly reviewStatus: "draft" | "submitted" | "approved" | "rejected" | "change_requested";
  readonly specification: readonly { readonly label: string; readonly value: string }[];
  readonly priceObservation: {
    readonly amountRub: number;
    readonly checkedAt: string;
    readonly sourceCode: string;
  } | null;
  readonly evidence: readonly EvidenceView[];
  readonly revisionHistory: readonly {
    readonly revisionNo: number;
    readonly revisionId: string;
    readonly reason: string;
    readonly status: "current" | "superseded";
  }[];
}

export interface DecisionView {
  readonly id: string;
  readonly title: string;
  readonly resolution: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly claimStatus: "extracted" | "interpreted" | "unknown" | "human_origin";
  readonly reviewStatus: "submitted" | "approved" | "change_requested";
  readonly evidence: readonly EvidenceView[];
}

export interface InvitationView {
  readonly id: string;
  readonly recipientLabel: string;
  readonly role: Exclude<ProjectCeoRole, "guest">;
  readonly scopeLabel: string;
  readonly status: "pending" | "accepted" | "revoked" | "expired";
  readonly expiresAt: string;
  readonly shareUrl: string | null;
}

export interface AccessGrantView {
  readonly id: string;
  readonly label: string;
  readonly packageId: string;
  readonly releaseId: string;
  readonly status: "active" | "revoked" | "expired";
  readonly expiresAt: string;
  readonly canAcknowledge: boolean;
  readonly shareUrl: string | null;
}

export interface ParticipantView {
  readonly id: string;
  readonly displayName: string;
  readonly role: ProjectCeoRole;
  readonly scopeLabel: string;
  readonly status: "active" | "invited" | "revoked";
}

export interface ChangeRequestView {
  readonly id: string;
  readonly title: string;
  readonly status: "submitted" | "impact_review" | "approved" | "released";
  readonly fromBaseline: string;
  readonly toBaseline: string | null;
  readonly deltaRub: number;
  readonly deltaDays: number;
  readonly requestedAt: string;
  readonly impactCount: number;
  readonly reviewedImpactCount: number;
  readonly reason: string;
  readonly impacts: readonly {
    readonly impactRunId: string;
    readonly impactId: string;
    readonly label: string;
    readonly disposition: "accepted" | "resolved" | "dismissed" | null;
  }[];
}

export interface PhotoMilestoneView {
  readonly id: string;
  readonly packageId: string;
  readonly area: string;
  readonly milestone: string;
  readonly photoCount: number;
  readonly status: "submitted" | "accepted" | "change_requested";
  readonly submittedAt: string;
  readonly areas: readonly {
    readonly areaNodeId: string;
    readonly photos: readonly {
      readonly id: string;
      readonly capturedAt: string;
      readonly decision: "accepted" | "rejected" | null;
    }[];
  }[];
}

export interface HandoverView {
  readonly status: "not_ready" | "ready" | "archived";
  readonly acceptedAreaCount: number;
  readonly totalAreaCount: number;
  readonly warrantyDocumentCount: number;
  readonly archiveHash: `sha256:${string}` | null;
}

export interface AuditEventView {
  readonly id: string;
  readonly event: string;
  readonly actorRole: ProjectCeoRole | "system";
  readonly occurredAt: string;
  readonly controlledDetail: string;
}

export interface ProjectWorkspaceView {
  readonly project: ProjectSummary;
  readonly actor: ProjectCeoActor;
  readonly packages: readonly ProjectPackageView[];
  readonly sources: readonly SourceRegistryItem[];
  readonly decisions: readonly DecisionView[];
  readonly selections: readonly SelectionView[];
  readonly baseline: BaselineSummary;
  readonly releases: readonly ReleaseSummary[];
  readonly changes: readonly ChangeRequestView[];
  readonly participants: readonly ParticipantView[];
  readonly invitations: readonly InvitationView[];
  readonly grants: readonly AccessGrantView[];
  readonly milestones: readonly PhotoMilestoneView[];
  readonly handover: HandoverView;
  readonly history: readonly AuditEventView[];
  readonly controlledAnalytics: readonly AnalyticsEvent[];
  readonly operations: ProjectCeoOperationStates;
}

export const PROJECTCEO_OPERATION_NAMES = [
  "create_invitation",
  "revoke_invitation",
  "revoke_guest_grant",
  "register_source",
  "review_source",
  "review_selection",
  "publish_baseline",
  "publish_release",
  "distribute_release",
  "acknowledge_release",
  "create_change",
  "review_change_impact",
  "upload_photo_evidence",
  "review_photo_evidence",
  "accept_milestone",
  "build_handover",
] as const;

export type ProjectCeoOperationName =
  (typeof PROJECTCEO_OPERATION_NAMES)[number];

export type ProjectCeoOperationState =
  | {
      readonly status: "available";
      readonly commandTargetId?: string;
    }
  | {
      readonly status: "unavailable";
      readonly reason:
        | "capability_missing"
        | "exact_scope_missing"
        | "prerequisite_missing"
        | "read_contract_pending"
        | "worker_only"
        | "fixture_read_only";
    };

export type ProjectCeoOperationStates = Readonly<
  Record<ProjectCeoOperationName, ProjectCeoOperationState>
>;

export interface OnboardingState {
  readonly organizationCreated: boolean;
  readonly projectCreated: boolean;
  readonly scopeMode: "full_project" | "work_package";
  readonly steps: readonly {
    readonly id: "organization" | "project" | "scope" | "participants";
    readonly label: string;
    readonly status: "complete" | "current" | "pending";
  }[];
}

export const ANALYTICS_EVENTS = [
  "organization_created",
  "project_created",
  "invitation_sent",
  "invitation_accepted",
  "invitation_revoked",
  "source_registered",
  "source_reviewed",
  "baseline_published",
  "selection_reviewed",
  "release_published",
  "release_distributed",
  "release_acknowledged",
  "change_requested",
  "impact_reviewed",
  "second_project_started",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENTS)[number];

export interface AnalyticsEvent {
  readonly name: AnalyticsEventName;
  readonly projectId: string | null;
  readonly packageId: string | null;
  readonly occurredAt: string;
}
