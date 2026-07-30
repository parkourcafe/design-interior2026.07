import type { ApprovalPackage, HumanActorRef } from "../decisions";

export const SOURCE_DOCUMENT_STATUSES = [
  "current",
  "previous",
  "reference",
  "unknown",
] as const;

export type SourceDocumentStatus = (typeof SOURCE_DOCUMENT_STATUSES)[number];
export type SourceAvailability = "materialized" | "placeholder";
export type SourceMediaKind =
  | "pdf"
  | "image"
  | "spreadsheet"
  | "plain_text"
  | "document"
  | "cad_binary"
  | "archive";

export interface SourceHierarchyRef {
  readonly projectId: string;
  readonly packageId: string;
  readonly floorId: string;
  readonly zoneId: string;
  readonly disciplineId: string;
}

export interface KoraInventoryRecord {
  readonly physicalRecordId: string;
  readonly sanitizedName: string;
  readonly hierarchy: SourceHierarchyRef;
  readonly availability: SourceAvailability;
  readonly documentStatus: SourceDocumentStatus;
  readonly mediaKind: SourceMediaKind;
  readonly sizeBytes: number | null;
  readonly checksum: string | null;
  readonly sourceRevisionId: string | null;
  readonly semanticConflict: boolean;
}

export const IMPORT_STAGES = [
  "inventory_registration",
  "bytes_materialization",
  "checksum_source_registration",
  "fragment_evidence_extraction",
  "human_review",
  "baseline_candidate",
  "baseline_publication",
] as const;

export type ImportStage = (typeof IMPORT_STAGES)[number];
export type ImportStageStatus = "completed" | "pending" | "blocked";

export interface ImportStageState {
  readonly stage: ImportStage;
  readonly status: ImportStageStatus;
  readonly blockReason: string | null;
}

export interface ImportPlanEntry {
  readonly physicalRecordId: string;
  readonly logicalSourceId: string | null;
  readonly sourceRevisionId: string | null;
  readonly checksum: string | null;
  readonly evidenceEligible: boolean;
  readonly quarantineReason:
    | "semantic_conflict"
    | "cad_preview_required"
    | "archive_expansion_required"
    | "text_extraction_required"
    | null;
  readonly stages: readonly ImportStageState[];
}

export interface ExactHashGroup {
  readonly checksum: string;
  readonly logicalSourceId: string;
  readonly sourceRevisionId: string;
  readonly physicalRecordIds: readonly string[];
  readonly semanticConflict: boolean;
}

export interface ImportPlan {
  readonly projectId: string;
  readonly entries: readonly ImportPlanEntry[];
  readonly exactHashGroups: readonly ExactHashGroup[];
  readonly summary: {
    readonly physicalRecords: number;
    readonly materializedRecords: number;
    readonly placeholders: number;
    readonly uniqueMaterializedBlobs: number;
    readonly duplicateGroups: number;
    readonly semanticConflictGroups: number;
  };
}

export type ProjectPackageKind = "project_root" | "work_package";

export interface ProjectPackage {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly parentPackageId: string | null;
  readonly kind: ProjectPackageKind;
  readonly stableKey: string;
  readonly name: string;
  readonly status: "active" | "archived";
}

export interface ConflictReview {
  readonly checksum: string;
  readonly disposition: "resolved" | "required_conflict";
  readonly actor: HumanActorRef | null;
  readonly reviewedAt: string | null;
  readonly reason: string | null;
}

export interface BaselineCandidateInput {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly previousBaselineId: string | null;
  readonly packages: readonly ProjectPackage[];
  readonly importPlan: ImportPlan;
  readonly includedSourceRevisionIds: readonly string[];
  readonly requirementRevisionIds: readonly string[];
  readonly assumptionRevisionIds: readonly string[];
  readonly decisionRevisionIds: readonly string[];
  readonly selectionRevisionIds: readonly string[];
  readonly approvalPackages: readonly ApprovalPackage[];
  readonly conflictReviews: readonly ConflictReview[];
}

export interface ProjectBaselineCandidate extends BaselineCandidateInput {
  readonly status: "ready" | "blocked";
  readonly blockers: readonly string[];
  readonly semanticContent: BaselineSemanticContent;
  readonly semanticHash: `sha256:${string}`;
}

export interface BaselineSemanticContent {
  readonly schemaVersion: "project-ceo-baseline/0.1";
  readonly organizationId: string;
  readonly projectId: string;
  readonly previousBaselineId: string | null;
  readonly packages: readonly {
    readonly id: string;
    readonly parentPackageId: string | null;
    readonly kind: ProjectPackageKind;
    readonly stableKey: string;
  }[];
  readonly packageIds: readonly string[];
  readonly sourceRevisionIds: readonly string[];
  readonly requirementRevisionIds: readonly string[];
  readonly assumptionRevisionIds: readonly string[];
  readonly decisionRevisionIds: readonly string[];
  readonly selectionRevisionIds: readonly string[];
  readonly approvalPackageIds: readonly string[];
}

export interface ProjectBaseline {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly versionNo: number;
  readonly previousBaselineId: string | null;
  readonly status: "published";
  readonly semanticContent: BaselineSemanticContent;
  readonly semanticHash: `sha256:${string}`;
  readonly publishedAt: string;
  readonly publishedBy: HumanActorRef;
}

export interface ExactRevisionRefs {
  readonly sources: readonly string[];
  readonly requirements: readonly string[];
  readonly assumptions: readonly string[];
  readonly decisions: readonly string[];
  readonly selections: readonly string[];
}

export interface ProductionPackageVersion {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly baselineId: string;
  readonly versionNo: number;
  readonly previousVersionId: string | null;
  readonly status: "published";
  readonly exactRevisionRefs: ExactRevisionRefs;
  readonly semanticHash: `sha256:${string}`;
  readonly publishedAt: string;
  readonly publishedBy: HumanActorRef;
}

export interface ReleaseLogicalContent {
  readonly schemaVersion: "project-ceo-release/0.1";
  readonly organizationId: string;
  readonly projectId: string;
  readonly packageId: string;
  readonly productionPackageVersionId: string;
  readonly productionPackageSemanticHash: `sha256:${string}`;
  readonly baselineId: string;
  readonly exactRevisionRefs: ProductionPackageVersion["exactRevisionRefs"];
  readonly artifacts: readonly {
    readonly kind: "logical_json" | "pdf" | "xlsx" | "csv";
    readonly contentHash: `sha256:${string}`;
  }[];
}

export interface ReleaseDescriptor {
  readonly logicalContent: ReleaseLogicalContent;
  readonly semanticHash: `sha256:${string}`;
}

export interface ReleaseArtifact {
  readonly id: string;
  readonly productionPackageVersionId: string;
  readonly format: "logical_json" | "pdf" | "xlsx" | "csv";
  readonly semanticHash: `sha256:${string}`;
  readonly idempotencyKey: string;
}

export interface ReleaseArtifactBuildRequest {
  readonly artifactId: string;
  readonly productionPackageVersionId: string;
  readonly format: ReleaseArtifact["format"];
  readonly semanticHash: `sha256:${string}`;
  readonly idempotencyKey: string;
}

export type ReleaseArtifactBuildOutcome =
  | { readonly kind: "created"; readonly artifact: ReleaseArtifact }
  | { readonly kind: "idempotent_replay"; readonly artifact: ReleaseArtifact }
  | { readonly kind: "existing_artifact"; readonly artifact: ReleaseArtifact }
  | { readonly kind: "idempotency_conflict" };

export interface NoChangeTerminal {
  readonly status: "approved_no_change";
  readonly baselineId: string;
  readonly productionPackageVersionId: string;
  readonly approvedAt: string;
  readonly approvedBy: HumanActorRef;
  readonly reason: string;
}

export interface BaselineRevisionDiff {
  readonly changed: boolean;
  readonly changedRequirementRevisionIds: readonly string[];
  readonly changedAssumptionRevisionIds: readonly string[];
  readonly changedDecisionRevisionIds: readonly string[];
  readonly changedSelectionRevisionIds: readonly string[];
  readonly impactRootRevisionIds: readonly string[];
}
