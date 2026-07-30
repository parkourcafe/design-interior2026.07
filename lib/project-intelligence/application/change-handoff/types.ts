import type {
  ContentOrigin,
  HumanClaimStatus,
  ImpactPathStep,
  JsonValue,
  NodeVersionChange,
  ProjectGraphSnapshot,
  ProjectVersionSnapshot,
  RevisionClaimStatus,
} from "../../index";

export type JsonObject = { readonly [key: string]: JsonValue };

export const CHANGE_HANDOFF_APPLICATION_ERROR_CODES = [
  "ACCESS_DENIED",
  "PROJECT_NOT_FOUND",
  "PROJECT_SCOPE_VIOLATION",
  "VERSION_STALE",
  "STATE_STALE",
  "IMPACT_STALE",
  "IDEMPOTENCY_CONFLICT",
  "INVALID_TRANSITION",
  "DOMAIN_CONTRACT_VIOLATION",
] as const;

export type ChangeHandoffApplicationErrorCode =
  (typeof CHANGE_HANDOFF_APPLICATION_ERROR_CODES)[number];

export interface ChangeHandoffApplicationError {
  readonly code: ChangeHandoffApplicationErrorCode;
  readonly retryable: boolean;
  readonly details?: JsonObject;
}

export type ChangeHandoffApplicationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ChangeHandoffApplicationError };

export const CHANGE_HANDOFF_CAPABILITIES = [
  "calculate_change_impact",
  "review_change_impact",
  "build_logical_handoff",
] as const;

export type ChangeHandoffCapability = (typeof CHANGE_HANDOFF_CAPABILITIES)[number];
export const APPLICATION_ACTOR_TYPES = ["human", "ai", "system"] as const;
export type ApplicationActorType = (typeof APPLICATION_ACTOR_TYPES)[number];

/** Trusted server-owned identity and project scope. Never populate from a command body. */
export interface ApplicationActorContext {
  readonly actorId: string;
  readonly actorType: ApplicationActorType;
  readonly organizationId: string;
  readonly projectId: string;
  readonly capabilities: readonly ChangeHandoffCapability[];
}

/** Trusted server-owned actor plus authoritative time/request correlation. */
export interface ApplicationExecutionContext extends ApplicationActorContext {
  readonly serverTime: string;
  readonly requestId: string;
}

export interface ChangeContext {
  readonly projectId: string;
  readonly fromVersionId: string;
  readonly toVersionId: string;
  readonly changeSetId: string;
  readonly reasonCode: string;
}

export interface ImpactAlgorithmDescriptor {
  readonly version: "project-intelligence-impact/0.1";
  readonly direction: "reverse_dependency";
  readonly propagatingRelations: readonly string[];
  readonly cyclePolicy: "shortest_path_per_changed_root";
  readonly ordering: "unicode_code_point";
}

export const IMPACT_DISPOSITIONS = ["accepted", "resolved", "dismissed"] as const;
export type ImpactDisposition = (typeof IMPACT_DISPOSITIONS)[number];
export const IMPACT_STATUSES = ["needs_review", ...IMPACT_DISPOSITIONS] as const;
export type ImpactStatus = (typeof IMPACT_STATUSES)[number];

/** Controlled values permitted in persisted reviews and controlled audit metadata. */
export const IMPACT_REASON_CODES = [
  "downstream_update_required",
  "cost_recalculation_required",
  "schedule_updated",
  "downstream_update_completed",
  "not_applicable_to_impacted_node",
  "not_applicable_to_deliverable",
] as const;
export type ImpactReasonCode = (typeof IMPACT_REASON_CODES)[number];

export interface PersistedImpact {
  readonly id: string;
  readonly impactRunId: string;
  readonly projectId: string;
  readonly changeSetId: string;
  readonly fromVersionId: string;
  readonly toVersionId: string;
  readonly changedNodeId: string;
  readonly impactedNodeId: string;
  readonly distance: number;
  readonly nodePath: readonly string[];
  readonly edgePath: readonly ImpactPathStep[];
  readonly initialStatus: "needs_review";
}

export interface ImpactRun {
  readonly id: string;
  readonly projectId: string;
  readonly changeSetId: string;
  readonly fromVersionId: string;
  readonly toVersionId: string;
  /** Exact calculation-time context; later review/handoff must use this immutable value. */
  readonly changeContext: ChangeContext;
  readonly targetGraphVersionId: string;
  /** SHA-256 of the normalized, exact calculation-time target graph. */
  readonly targetGraphDigest: `sha256:${string}`;
  readonly algorithm: ImpactAlgorithmDescriptor;
  readonly changes: readonly NodeVersionChange[];
  readonly changedNodeIds: readonly string[];
  readonly impacts: readonly PersistedImpact[];
  readonly resultDigest: `sha256:${string}`;
  readonly createdAt: string;
  readonly createdBy: {
    readonly actorId: string;
    readonly actorType: ApplicationActorType;
  };
}

export interface ImpactReview {
  readonly id: string;
  readonly projectId: string;
  readonly impactRunId: string;
  readonly impactId: string;
  readonly previousStatus: ImpactStatus;
  readonly disposition: ImpactDisposition;
  readonly reasonCode: ImpactReasonCode;
  readonly actor: {
    readonly actorId: string;
    readonly actorType: "human";
  };
  readonly reviewedAt: string;
}

export interface PublishedProjectVersion {
  readonly status: "published";
  readonly snapshot: ProjectVersionSnapshot;
  readonly versionNo: number;
  readonly baseVersionId: string | null;
  readonly label: string;
}

export interface HandoffSourceReferenceProjection {
  readonly evidenceLinkId: string;
  readonly referenceId: string;
  /** Trusted application display projection; source/fragment identity still comes from the graph. */
  readonly locator: JsonValue;
}

export interface HandoffPolicyInput {
  readonly canonicalMetadata: JsonObject;
  readonly displayMetadata: JsonObject;
  readonly sourceReferenceProjections?: readonly HandoffSourceReferenceProjection[];
}

export type EffectiveClaimStatus = RevisionClaimStatus | HumanClaimStatus;

export interface LogicalHandoffArea {
  readonly nodeId: string;
  readonly revisionId: string;
  readonly stableKey: string;
  readonly name: string;
}

export interface LogicalHandoffRequirement {
  readonly nodeId: string;
  readonly revisionId: string;
  readonly claimStatus: EffectiveClaimStatus;
  readonly contentOrigin: ContentOrigin;
  readonly summary: string;
  readonly sourceReferenceIds: readonly string[];
}

export interface LogicalHandoffDecisionProvenance {
  readonly changeSetId: string;
  readonly previousRevisionId: string;
  readonly previousSourceReferenceIds: readonly string[];
  readonly reasonCode: string;
}

export interface LogicalHandoffDecision {
  readonly nodeId: string;
  readonly revisionId: string;
  readonly claimStatus: EffectiveClaimStatus;
  readonly contentOrigin: ContentOrigin;
  readonly material: string;
  readonly summary: string;
  readonly provenance?: LogicalHandoffDecisionProvenance;
}

export interface LogicalHandoffItem {
  readonly nodeId: string;
  readonly revisionId: string;
  readonly areaNodeId: string;
  readonly name: string;
  readonly sourceReferenceIds: readonly string[];
}

export interface LogicalHandoffDeliverable {
  readonly nodeId: string;
  readonly revisionId: string;
  readonly title: string;
}

export interface LogicalHandoffSourceReference {
  readonly id: string;
  readonly sourceId: string;
  readonly fragmentId: string;
  readonly locator: JsonValue;
  readonly evidenceRole: "direct" | "superseded_input";
}

export interface LogicalHandoffImpact {
  readonly impactId: string;
  readonly status: ImpactDisposition;
  readonly changedNodeId: string;
  readonly impactedNodeId: string;
  readonly nodePath: readonly string[];
  readonly edgeIds: readonly string[];
}

export interface LogicalHandoffContent {
  readonly schemaVersion: "project-intelligence-handoff/0.1";
  readonly project: {
    readonly projectId: string;
    readonly versionId: string;
    readonly versionNo: number;
    readonly baseVersionId: string | null;
    readonly label: string;
  };
  readonly canonicalMetadata: JsonObject;
  readonly displayMetadata: JsonObject;
  readonly areas: readonly LogicalHandoffArea[];
  readonly requirements: readonly LogicalHandoffRequirement[];
  readonly decisions: readonly LogicalHandoffDecision[];
  readonly items: readonly LogicalHandoffItem[];
  readonly deliverables: readonly LogicalHandoffDeliverable[];
  readonly sourceReferences: readonly LogicalHandoffSourceReference[];
  readonly impacts: {
    readonly unresolved: readonly LogicalHandoffImpact[];
    readonly resolved: readonly LogicalHandoffImpact[];
  };
}

export interface HandoffArtifactDescriptor {
  readonly artifactId: string;
  readonly format: "logical_json";
  readonly jobStatus: "ready";
  readonly generatedAt: string;
  readonly semanticContentHash: `sha256:${string}`;
}

export interface LogicalHandoff {
  readonly contractVersion: "project-intelligence-vertical-slice/0.1";
  readonly artifact: HandoffArtifactDescriptor;
  readonly hashContract: {
    readonly algorithm: "sha256";
    readonly encoding: "utf-8";
    readonly canonicalization: "recursive_sorted_object_keys_arrays_preserve_contract_order";
    readonly hashedField: "logicalContent";
    readonly excludedVolatileFields: readonly ["artifactId", "generatedAt", "jobStatus"];
  };
  readonly logicalContent: LogicalHandoffContent;
}

export type ChangeHandoffAuditEventName =
  | "impact_run_created"
  | "impact_reviewed"
  | "logical_handoff_built";

export interface ChangeHandoffAuditIntent {
  readonly eventName: ChangeHandoffAuditEventName;
  readonly projectId: string;
  readonly organizationId: string;
  readonly actorId: string;
  readonly actorType: ApplicationActorType;
  readonly occurredAt: string;
  readonly requestId: string;
  readonly controlledMetadata: JsonObject;
}

export type ChangeHandoffOperation = "calculate_impact" | "review_impact" | "build_handoff";
export type ChangeHandoffMutationValue = ImpactRun | ImpactReview | LogicalHandoff;

export interface ChangeHandoffIdempotencyRecord {
  readonly organizationId: string;
  readonly projectId: string;
  readonly operation: ChangeHandoffOperation;
  readonly key: string;
  readonly requestDigest: `sha256:${string}`;
  readonly logicalResult: ChangeHandoffMutationValue;
}

/** Persisted shape for an owning atomic port. This module makes no durability claim. */
export interface ChangeHandoffApplicationState {
  readonly organizationId: string;
  readonly projectId: string;
  readonly stateRevision: number;
  readonly impactRuns: readonly ImpactRun[];
  readonly impactReviews: readonly ImpactReview[];
  readonly handoffs: readonly LogicalHandoff[];
  readonly idempotencyRecords: readonly ChangeHandoffIdempotencyRecord[];
}

export interface ChangeHandoffMutationSuccess<T extends ChangeHandoffMutationValue> {
  readonly result: T;
  readonly nextState: ChangeHandoffApplicationState;
  readonly idempotentReplay: boolean;
  /** Empty on replay. The owner commits new state + these intents atomically. */
  readonly auditIntents: readonly ChangeHandoffAuditIntent[];
  readonly requestDigest: `sha256:${string}`;
}

export type ChangeHandoffIdKind =
  | "impact_run"
  | "impact"
  | "impact_review"
  | "handoff_artifact"
  | "source_reference";

export interface ChangeHandoffIdInput {
  readonly kind: ChangeHandoffIdKind;
  readonly projectId: string;
  readonly semanticIdentity: string;
  readonly hints: Readonly<Record<string, string>>;
}

/** Server-side only. Implementations must be stable for the same semantic identity. */
export interface ChangeHandoffIdFactory {
  createId(input: ChangeHandoffIdInput): string;
}

export interface CalculateImpactRunCommand {
  readonly execution: ApplicationExecutionContext;
  readonly state: ChangeHandoffApplicationState;
  readonly expectedStateRevision: number;
  readonly changeContext: ChangeContext;
  readonly fromVersion: ProjectVersionSnapshot;
  readonly toVersion: ProjectVersionSnapshot;
  readonly targetGraph: ProjectGraphSnapshot;
  readonly idempotencyKey: string;
}

export interface ReviewImpactCommand {
  readonly execution: ApplicationExecutionContext;
  readonly state: ChangeHandoffApplicationState;
  readonly expectedStateRevision: number;
  readonly impactRun: ImpactRun;
  readonly impactId: string;
  readonly expectedImpactStatus: ImpactStatus;
  readonly disposition: ImpactDisposition;
  /** Transport-boundary input; the service narrows this against IMPACT_REASON_CODES at runtime. */
  readonly reasonCode: string;
  readonly idempotencyKey: string;
}

export interface BuildLogicalHandoffCommand {
  readonly execution: ApplicationExecutionContext;
  readonly state: ChangeHandoffApplicationState;
  readonly expectedStateRevision: number;
  readonly changeContext: ChangeContext;
  readonly targetVersion: PublishedProjectVersion;
  readonly targetGraph: ProjectGraphSnapshot;
  readonly impactRun: ImpactRun;
  readonly reviews: readonly ImpactReview[];
  readonly policy: HandoffPolicyInput;
  readonly idempotencyKey: string;
}
