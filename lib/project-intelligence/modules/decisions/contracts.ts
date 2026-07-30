export const REVISION_CLAIM_STATUSES = [
  "extracted",
  "interpreted",
  "unknown",
  "human_origin",
] as const;

export type RevisionClaimStatus = (typeof REVISION_CLAIM_STATUSES)[number];

export const REVISION_REVIEW_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "change_requested",
  "superseded",
] as const;

export type RevisionReviewStatus = (typeof REVISION_REVIEW_STATUSES)[number];

export interface HumanActorRef {
  readonly actorId: string;
  readonly actorType: "human";
}

export interface SystemActorRef {
  readonly actorId: string;
  readonly actorType: "system";
}

export type RevisionActorRef = HumanActorRef | SystemActorRef;

export interface EvidenceReference {
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
  readonly fragmentId?: string;
}

export interface RevisionIdentity {
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly createdAt: string;
  readonly createdBy: RevisionActorRef;
  readonly reason: string;
}

export interface RevisionBase {
  readonly id: string;
  readonly projectId: string;
  readonly entityId: string;
  readonly revisionNo: number;
  readonly claimStatus: RevisionClaimStatus;
  readonly reviewStatus: RevisionReviewStatus;
  readonly evidence: readonly EvidenceReference[];
  readonly createdAt: string;
  readonly createdBy: RevisionActorRef;
  readonly reason: string;
  readonly replacesRevisionId: string | null;
}

export interface RequirementRevision extends RevisionBase {
  readonly kind: "requirement";
  readonly statement: string;
  readonly areaId: string | null;
  readonly packageId: string;
}

export interface AssumptionRevision extends RevisionBase {
  readonly kind: "assumption";
  readonly statement: string;
  readonly areaId: string | null;
  readonly packageId: string;
  readonly validationNeeded: string;
}

export interface DecisionRevision extends RevisionBase {
  readonly kind: "decision";
  readonly title: string;
  readonly resolution: string;
  readonly areaId: string | null;
  readonly packageId: string;
  readonly status: "proposed" | "confirmed" | "superseded";
}

export interface PriceObservation {
  readonly id: string;
  readonly projectId: string;
  readonly selectionRevisionId: string;
  readonly amountRub: number;
  readonly observedAt: string;
  readonly evidence: EvidenceReference;
  readonly supplierRef: string | null;
}

export interface SelectionRevision extends RevisionBase {
  readonly kind: "selection";
  readonly title: string;
  readonly areaId: string;
  readonly packageId: string;
  readonly decisionRevisionId: string;
  readonly specification: Readonly<Record<string, string>>;
  readonly priceObservations: readonly PriceObservation[];
}

export type ApprovalTargetKind =
  | "requirement_revision"
  | "assumption_revision"
  | "decision_revision"
  | "selection_revision";

export interface ApprovalPackageItem {
  readonly targetKind: ApprovalTargetKind;
  readonly entityId: string;
  readonly revisionId: string;
}

export const APPROVAL_PACKAGE_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "rejected",
  "change_requested",
] as const;

export type ApprovalPackageStatus = (typeof APPROVAL_PACKAGE_STATUSES)[number];

export interface ApprovalPackageReview {
  readonly decision: Exclude<ApprovalPackageStatus, "draft" | "submitted">;
  readonly actor: HumanActorRef;
  readonly reviewedAt: string;
  readonly reason: string;
}

export interface ApprovalPackage {
  readonly id: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly items: readonly ApprovalPackageItem[];
  readonly status: ApprovalPackageStatus;
  readonly submittedAt: string | null;
  readonly submittedBy: HumanActorRef | null;
  readonly review: ApprovalPackageReview | null;
}

export type RevisionEntity =
  | RequirementRevision
  | AssumptionRevision
  | DecisionRevision
  | SelectionRevision;
