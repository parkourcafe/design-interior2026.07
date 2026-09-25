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
  "manage_budget",
  "prepare_client_handoff",
] as const;

export type ProjectCeoCapability = (typeof PROJECTCEO_CAPABILITIES)[number];

export const PROJECTCEO_TABS = [
  "overview",
  "passport",
  "sources",
  "decisions",
  "documentation",
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

export interface M1ProjectFactView {
  readonly id: string;
  readonly factType: "requirement" | "constraint" | "assumption" | "open_question";
  readonly title: string;
  readonly detail: string | null;
  readonly extractionKind: "extracted" | "interpreted" | "human_stated";
  readonly sourceId: string | null;
  readonly sourceRevisionId: string | null;
  readonly statedReason: string | null;
  readonly createdAt: string;
  readonly supersededAt: string | null;
}

export interface M1ApprovalRequestView {
  readonly id: string;
  readonly subjectKind: "project_passport" | "client_passport";
  readonly subjectId: string;
  readonly approverCapability: string;
  readonly status: "draft" | "submitted" | "approved" | "rejected";
  readonly requestedByCurrentActor: boolean;
  readonly requestedReason: string;
  readonly selfApproved: boolean;
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  readonly createdAt: string;
}

export interface M1ContractedPassportView {
  readonly projectId: string;
  readonly revisionNo: number;
  readonly passport: Readonly<Record<string, unknown>>;
  readonly llmOk: boolean;
  readonly createdAt: string;
}

export interface M1ContractDocumentView {
  readonly documentId: string;
  readonly status: "uploaded" | "received" | "signed" | "archived";
  readonly createdAt: string;
  readonly statusUpdatedAt: string | null;
}

export interface M1WorkspaceView {
  readonly facts: readonly M1ProjectFactView[];
  readonly approvalRequests: readonly M1ApprovalRequestView[];
  readonly contractedPassport?: M1ContractedPassportView | null;
  readonly contractDocument?: M1ContractDocumentView | null;
  readonly stateRevision?: number | null;
}

export interface SourceRegistryItem {
  readonly id: string;
  readonly sourceRevisionId: string | null;
  /**
   * Ревизия, по которой человек выносит решение. Отдельно от
   * `sourceRevisionId`, потому что решение адресуется именно ревизии, и
   * кнопка ревью не должна догадываться, какое из полей брать.
   */
  readonly reviewTargetRevisionId: string | null;
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
  readonly areaNodeId: string | null;
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
  readonly packageId: string;
  readonly areaNodeId: string | null;
  readonly title: string;
  readonly resolution: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly claimStatus: "extracted" | "interpreted" | "unknown" | "human_origin";
  readonly reviewStatus: "submitted" | "approved" | "change_requested";
  readonly evidence: readonly EvidenceView[];
}

export interface ApprovalPackageView {
  readonly id: string;
  readonly packageId: string;
  readonly status: "draft" | "submitted" | "approved" | "rejected" | "change_requested";
  readonly selfApproved: boolean;
  readonly items: readonly {
    readonly targetKind: "requirement_revision" | "assumption_revision" | "decision_revision" | "selection_revision";
    readonly entityId: string;
    readonly revisionId: string;
  }[];
  readonly createdAt: string;
}

export interface M2RoomView {
  readonly id: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly name: string;
  readonly areaM2: number;
  readonly status: "draft" | "submitted" | "approved" | "ready";
  readonly createdAt: string;
}

export interface M2VariantView {
  readonly id: string;
  readonly roomId: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly title: string;
  readonly description: string;
  readonly status: "draft" | "submitted" | "approved" | "ready";
  readonly createdAt: string;
}

export interface M2MaterialView {
  readonly id: string;
  readonly variantId: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly name: string;
  readonly supplierRef: string;
  readonly unit: string;
  readonly unitCostRub: number;
  readonly quantity: number;
  readonly status: "draft" | "submitted" | "approved" | "ready";
  readonly createdAt: string;
}

export interface M2BudgetFrameView {
  readonly id: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly currency: "RUB";
  readonly minRub: number;
  readonly maxRub: number;
  readonly contingencyPct: number;
  readonly status: "draft" | "submitted" | "approved" | "ready";
  readonly createdAt: string;
}

export interface M2ClientHandoffView {
  readonly id: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly approvalPackageId: string;
  readonly title: string;
  readonly note: string;
  readonly status: "draft" | "submitted" | "approved" | "ready";
  readonly createdAt: string;
}

export interface M2ClientReviewVariantView {
  readonly variantId: string;
  readonly role: "preferred" | "value_engineered" | "premium";
  readonly layoutDocumentId: string;
  readonly layoutVersionId: string;
  readonly layoutRevisionId: string;
  readonly semanticHash: `sha256:${string}`;
  readonly selectionRevisionIds: readonly string[];
  readonly selections: readonly { readonly revisionId: string; readonly title: string; readonly supplierRef: string }[];
  readonly budget: {
    readonly amountRub: number;
    readonly staleSelectionRevisionIds: readonly string[];
    readonly missingPriceSelectionRevisionIds: readonly string[];
  };
}

export interface M2ClientReviewSubmissionView {
  readonly id: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly status: "submitted";
  readonly assignedClientUserId: string;
  readonly approvalPackageId: string;
  readonly roomId: string;
  readonly designIntentRevisionId: string;
  readonly variants: readonly M2ClientReviewVariantView[];
  readonly budgetAsOf: string;
  readonly staleAfterDays: number;
  readonly createdAt: string;
}

export interface M2ClientReviewView {
  readonly id: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly status: "approved" | "rejected" | "change_requested";
  readonly submissionId: string;
  readonly chosenVariantId: string;
  readonly createdAt: string;
}

export interface M2M3HandoffView {
  readonly id: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly status: "published";
  readonly approvedCommitId: string;
  readonly approvedCommitRevisionId: string;
  readonly layoutRevisionId: string;
  readonly selectionRevisionIds: readonly string[];
  readonly budget: { readonly amountRub: number | null };
  readonly createdAt: string;
}

export interface M2ApprovedCommitView {
  readonly id: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly layoutRevisionId: string;
  readonly selectionRevisionIds: readonly string[];
  readonly amountRub: number | null;
  readonly clientSubmissionId: string | null;
}

export interface M2LayoutVersionView {
  readonly documentId: string;
  readonly versionId: string;
  readonly packageId: string;
  readonly revisionId: string;
  readonly roomId: string;
  readonly variantId: string;
  readonly role: "preferred" | "value_engineered" | "premium";
  readonly semanticHash: `sha256:${string}`;
  readonly selectionRevisionIds: readonly string[];
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
  /**
   * Run incompleteness. Without these fields "8 of 8" would look like a
   * finished review even where the walk never reached the end of the graph —
   * the exact false status the owner's 2026-08-12 decision forbids.
   */
  readonly impactRunId: string | null;
  readonly impactTruncated: boolean;
  readonly impactTruncationReason: "depth_limit" | "result_limit" | null;
  readonly impactCalculatedDepth: number | null;
  readonly impactPolicyMaxDepth: number | null;
  /**
   * DEC-034 coverage contract (correction over PR #94's truncation-as-data
   * model). `null` until a run exists. `coverageStatus === null` never means
   * "complete" — the caller must check for `null` explicitly before reading
   * any of these.
   */
  readonly coverageStatus: "complete" | "partial_depth" | "blocked_result_limit" | null;
  readonly cutoffReason: "depth_boundary" | "result_limit" | null;
  readonly hasMoreBeyondDepth: boolean;
  readonly knownImpactCountLowerBound: number | null;
  readonly returnedImpactCount: number | null;
  readonly policyVersion: string | null;
  readonly maxImpacts: number | null;
  /** All RETURNED cards reviewed — vacuously true when returnedImpactCount is 0. */
  readonly allReturnedImpactsReviewed: boolean;
  /** The walk itself is exhausted (`coverageStatus === "complete"`). */
  readonly coverageComplete: boolean;
  /** `allReturnedImpactsReviewed AND coverageComplete` — no human override. */
  readonly impactReviewComplete: boolean;
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

/**
 * Лист пакета документации в интерфейсе: последняя ревизия и происхождение,
 * по которому его можно проверить. Подпись планировки показывается как есть —
 * это и есть доказательство, ради которого лист существует.
 */
export interface DocumentationSheetView {
  readonly sheetId: string;
  readonly packageId: string;
  readonly sheetNumber: string;
  readonly title: string;
  readonly roomId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly specificationRevisionIds: readonly string[];
  readonly layoutSemanticHash: string;
  readonly approvedM2CommitRevisionId: string;
}

/**
 * Комплектность пакета по одному утверждённому решению M2. Считается кодом
 * модуля (reviewPackageCompleteness) на прочитанных листах: интерфейс называет
 * нехватку, но ничего не утверждает и не выпускает.
 */
export interface DocumentationCompletenessView {
  readonly handoffId: string;
  readonly handoffRevisionId: string;
  readonly packageId: string;
  readonly roomId: string;
  readonly complete: boolean;
  readonly findings: readonly {
    readonly code:
      | "ROOM_WITHOUT_SHEET"
      | "SPECIFICATION_NOT_COVERED"
      | "SHEET_FROM_OTHER_APPROVAL"
      | "DUPLICATE_SHEET_NUMBER";
    readonly subject: string;
  }[];
}

/**
 * Раздел документации рабочего пространства. `null` означает ровно одно:
 * поверхности нет для этого человека — модуль выключен или роль его не видит.
 * Пустой раздел (нет листов) — это не то же самое, и он не null.
 */
export interface DocumentationView {
  readonly sheets: readonly DocumentationSheetView[];
  readonly completeness: readonly DocumentationCompletenessView[];
}

export interface ProjectStageRevisionView {
  readonly stageId: "01_brief" | "02_concept_offer" | "03_preliminary_design" | "04_design_development" | "05_technical_documentation" | "06_preconstruction" | "07_construction_closeout";
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly resultRevisionId: string | null;
  readonly ownerUserId: string;
  readonly plannedAt: string | null;
  readonly actualAt: string | null;
  readonly blockerReason: string | null;
  readonly approvalStatus: "draft" | "submitted" | "approved" | "rejected" | "change_requested" | null;
  readonly notApplicableReason: string | null;
}

export interface ProjectWorkspaceView {
  readonly project: ProjectSummary;
  readonly actor: ProjectCeoActor;
  readonly m1: M1WorkspaceView;
  readonly packages: readonly ProjectPackageView[];
  readonly sources: readonly SourceRegistryItem[];
  readonly decisions: readonly DecisionView[];
  readonly selections: readonly SelectionView[];
  readonly approvalPackages: readonly ApprovalPackageView[];
  readonly m2Rooms: readonly M2RoomView[];
  readonly m2Variants: readonly M2VariantView[];
  readonly m2Materials: readonly M2MaterialView[];
  readonly m2BudgetFrames: readonly M2BudgetFrameView[];
  readonly m2ClientHandoffs: readonly M2ClientHandoffView[];
  readonly m2ClientReviewSubmissions: readonly M2ClientReviewSubmissionView[];
  readonly m2ClientReviews: readonly M2ClientReviewView[];
  readonly m2M3Handoffs: readonly M2M3HandoffView[];
  readonly m2ApprovedCommits: readonly M2ApprovedCommitView[];
  readonly m2LayoutVersions: readonly M2LayoutVersionView[];
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
  readonly documentation: DocumentationView | null;
  readonly stageRevisions?: readonly ProjectStageRevisionView[];
  readonly operations: ProjectCeoOperationStates;
}

export const PROJECTCEO_OPERATION_NAMES = [
  "create_project_fact",
  "create_approval_request",
  "submit_approval_request",
  "decide_approval_request",
  "create_invitation",
  "revoke_invitation",
  "revoke_guest_grant",
  "register_source",
  "review_source",
  "register_documentation_sheet",
  "attach_documentation_sheet_specifications",
  "review_selection",
  "create_decision",
  "create_selection",
  "create_approval_package",
  "submit_approval_package",
  "create_m2_room",
  "create_m2_variant",
  "create_m2_material",
  "set_m2_budget",
  "create_m2_client_handoff",
  "publish_baseline",
  "publish_release",
  "distribute_release",
  "acknowledge_release",
  "create_change",
  "review_change_impact",
  "acknowledge_impact_truncation",
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
        // Модуль включён, но именно этот инкремент не открыт ни одним
        // подписанным документом (A6 §1.1: инкремент 2 модуля 4). Причина
        // отдельная от `module_disabled` намеренно: сказать «модуль выключен»
        // там, где он включён, значит соврать о состоянии системы.
        | "increment_not_authorized"
        // Поверхность принадлежит модулю, который владелец ещё не включил.
        | "module_disabled"
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
