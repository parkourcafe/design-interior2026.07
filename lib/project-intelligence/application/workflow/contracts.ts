import type {
  GraphNodeRevision,
  HumanClaimStatus,
  HumanReview,
  HumanReviewDecision,
  JsonValue,
  ProjectGraphSnapshot,
} from "../../index";

export const WORKFLOW_CAPABILITIES = [
  "review_claim",
  "publish_version",
  "revise_decision",
] as const;

export type WorkflowCapability = (typeof WORKFLOW_CAPABILITIES)[number];

export interface ApplicationActorContext {
  readonly actorId: string;
  readonly actorType: "human" | "ai" | "system";
  readonly organizationId: string;
  readonly projectId: string;
  readonly capabilities: readonly WorkflowCapability[];
}

export interface WorkflowExecutionContext {
  readonly actor: ApplicationActorContext;
  readonly serverTime: string;
  readonly requestId: string;
}

export const WORKFLOW_APPLICATION_ERROR_CODES = [
  "ACCESS_DENIED",
  "PROJECT_NOT_FOUND",
  "PROJECT_SCOPE_VIOLATION",
  "REVISION_STALE",
  "VERSION_STALE",
  "STATE_STALE",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_TRANSITION",
  "CHANGE_REASON_REQUIRED",
  "EVIDENCE_ACK_REQUIRED",
  "DOMAIN_CONTRACT_VIOLATION",
] as const;

export type WorkflowApplicationErrorCode =
  (typeof WORKFLOW_APPLICATION_ERROR_CODES)[number];

export type WorkflowErrorDetailValue =
  | string
  | number
  | boolean
  | null
  | readonly string[];

export interface WorkflowApplicationError {
  readonly code: WorkflowApplicationErrorCode;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, WorkflowErrorDetailValue>>;
}

export type WorkflowApplicationResult<T> =
  | { readonly ok: true; readonly value: T; readonly idempotentReplay: boolean }
  | { readonly ok: false; readonly error: WorkflowApplicationError };

export interface WorkflowRecordedActor {
  readonly actorId: string;
  readonly actorType: "human" | "ai" | "system";
}

export interface PublishedWorkflowVersion {
  readonly id: string;
  readonly projectId: string;
  readonly versionNo: number;
  readonly baseVersionId: string | null;
  readonly label: string | null;
  readonly snapshot: ProjectGraphSnapshot;
  readonly publishedAt: string;
  readonly publishedBy: WorkflowRecordedActor;
}

export const WORKFLOW_CHANGE_REASON_CODES = [
  "schedule_constraint",
  "budget_constraint",
  "client_preference",
  "scope_change",
  "technical_constraint",
  "regulatory_requirement",
  "correction",
] as const;

export type WorkflowChangeReasonCode =
  (typeof WORKFLOW_CHANGE_REASON_CODES)[number];

interface WorkflowChangeSetBase {
  readonly id: string;
  readonly projectId: string;
  readonly nodeId: string;
  readonly fromVersionId: string;
  readonly fromRevisionId: string;
  readonly toRevisionId: string;
  readonly reasonCode: WorkflowChangeReasonCode;
  /** Protected record content. It must not be copied into audit/log projections. */
  readonly reason: string;
  readonly actor: WorkflowRecordedActor & { readonly actorType: "human" };
  readonly occurredAt: string;
}

export interface PendingWorkflowChangeSet extends WorkflowChangeSetBase {
  readonly status: "pending_publication";
  readonly toVersionId: null;
}

export interface PublishedWorkflowChangeSet extends WorkflowChangeSetBase {
  readonly status: "published";
  readonly toVersionId: string;
}

export type WorkflowChangeSet =
  | PendingWorkflowChangeSet
  | PublishedWorkflowChangeSet;

export interface WorkflowState {
  readonly organizationId: string;
  readonly projectId: string;
  readonly stateRevision: number;
  readonly draft: ProjectGraphSnapshot;
  readonly publishedVersions: readonly PublishedWorkflowVersion[];
  readonly changeSets: readonly WorkflowChangeSet[];
}

export type WorkflowOperation =
  | "review_claim"
  | "publish_version"
  | "revise_decision";

/**
 * The digest is produced from the canonical command body only. Server time,
 * request ID, actor metadata and idempotency key are intentionally excluded.
 */
export interface WorkflowCommandIdentity {
  readonly organizationId: string;
  readonly projectId: string;
  readonly operation: WorkflowOperation;
  readonly idempotencyKey: string;
  readonly digest: string;
}

export interface WorkflowCommandDigester {
  digestCanonicalCommand(canonicalCommand: string): string | Promise<string>;
}

export type WorkflowIdKind = "review" | "version" | "revision" | "change_set";

export interface WorkflowIdFactory {
  nextId(input: {
    readonly kind: WorkflowIdKind;
    readonly projectId: string;
  }): string | Promise<string>;
}

interface WorkflowAuditIntentBase {
  readonly organizationId: string;
  readonly projectId: string;
  readonly actor: WorkflowRecordedActor;
  readonly occurredAt: string;
  readonly requestId: string;
}

export interface ClaimReviewedAuditIntent extends WorkflowAuditIntentBase {
  readonly eventType: "claim_review_confirmed" | "claim_review_rejected";
  readonly reviewId: string;
  readonly targetRevisionId: string;
}

export interface ProjectVersionPublishedAuditIntent extends WorkflowAuditIntentBase {
  readonly eventType: "project_version_published";
  readonly versionId: string;
  readonly baseVersionId: string | null;
  readonly versionNo: number;
  readonly selectedRevisionCount: number;
  readonly linkedChangeSetIds: readonly string[];
}

export interface ConfirmedDecisionRevisedAuditIntent
  extends WorkflowAuditIntentBase {
  readonly eventType: "confirmed_decision_revised";
  readonly changeSetId: string;
  readonly nodeId: string;
  readonly fromRevisionId: string;
  readonly toRevisionId: string;
  readonly reasonCode: WorkflowChangeReasonCode;
}

export type WorkflowAuditIntent =
  | ClaimReviewedAuditIntent
  | ProjectVersionPublishedAuditIntent
  | ConfirmedDecisionRevisedAuditIntent;

export interface ReviewClaimCommand {
  readonly projectId: string;
  readonly targetRevisionId: string;
  readonly expectedRevisionId: string;
  readonly expectedStateRevision: number;
  readonly decision: HumanReviewDecision;
  readonly idempotencyKey: string;
}

export interface SelectedWorkflowRevision {
  readonly nodeId: string;
  readonly revisionId: string;
}

export interface PublishVersionCommand {
  readonly projectId: string;
  readonly expectedLatestVersionId: string | null;
  readonly expectedStateRevision: number;
  readonly label?: string | null;
  readonly selectedRevisions?: readonly SelectedWorkflowRevision[];
  readonly idempotencyKey: string;
}

export interface ReviseDecisionCommand {
  readonly projectId: string;
  readonly nodeId: string;
  readonly baseVersionId: string;
  readonly expectedRevisionId: string;
  readonly expectedStateRevision: number;
  readonly title: string;
  readonly payload: JsonValue;
  readonly reasonCode: WorkflowChangeReasonCode;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface ReviewClaimOutcome {
  readonly stateRevision: number;
  readonly review: HumanReview;
  readonly effectiveClaimStatus: HumanClaimStatus;
}

export interface PublishVersionOutcome {
  readonly stateRevision: number;
  readonly version: PublishedWorkflowVersion;
  readonly linkedChangeSetIds: readonly string[];
}

export interface ReviseDecisionOutcome {
  readonly stateRevision: number;
  readonly revision: GraphNodeRevision;
  readonly review: HumanReview;
  readonly changeSet: PendingWorkflowChangeSet;
}

export type WorkflowStoredResult =
  | { readonly operation: "review_claim"; readonly value: ReviewClaimOutcome }
  | { readonly operation: "publish_version"; readonly value: PublishVersionOutcome }
  | { readonly operation: "revise_decision"; readonly value: ReviseDecisionOutcome };

export interface WorkflowLoadRequest {
  readonly projectId: string;
  readonly organizationId: string;
  readonly commandIdentity: WorkflowCommandIdentity;
}

export type WorkflowLoadResult =
  | { readonly kind: "loaded"; readonly state: WorkflowState }
  | { readonly kind: "replay"; readonly result: WorkflowStoredResult }
  | { readonly kind: "idempotency_conflict" }
  | { readonly kind: "not_found" };

export interface WorkflowAtomicCommit {
  readonly projectId: string;
  readonly organizationId: string;
  readonly expectedStateRevision: number;
  readonly commandIdentity: WorkflowCommandIdentity;
  readonly nextState: WorkflowState;
  readonly auditIntents: readonly WorkflowAuditIntent[];
  readonly result: WorkflowStoredResult;
}

export type WorkflowCommitResult =
  | { readonly kind: "committed" }
  | { readonly kind: "replay"; readonly result: WorkflowStoredResult }
  | { readonly kind: "idempotency_conflict" }
  | {
      readonly kind: "state_stale";
      readonly currentStateRevision: number | null;
    }
  | { readonly kind: "not_found" };

/**
 * A production adapter must commit nextState, the idempotency record/result and
 * every audit intent in one transaction. It must re-check both the idempotency
 * identity and expectedStateRevision inside that transaction.
 */
export interface WorkflowStatePort {
  load(request: WorkflowLoadRequest): Promise<WorkflowLoadResult>;
  commit(request: WorkflowAtomicCommit): Promise<WorkflowCommitResult>;
}

export interface WorkflowApplicationService {
  reviewClaim(
    context: WorkflowExecutionContext,
    command: ReviewClaimCommand,
  ): Promise<WorkflowApplicationResult<ReviewClaimOutcome>>;
  publishVersion(
    context: WorkflowExecutionContext,
    command: PublishVersionCommand,
  ): Promise<WorkflowApplicationResult<PublishVersionOutcome>>;
  reviseDecision(
    context: WorkflowExecutionContext,
    command: ReviseDecisionCommand,
  ): Promise<WorkflowApplicationResult<ReviseDecisionOutcome>>;
}
