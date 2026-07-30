import type {
  ProjectBrainActorContext,
  ProjectBrainHumanActorContext,
  ProjectBrainMutationResult,
} from "../decisions";
import type {
  EvidenceLink,
  GraphNodeRevision,
  ProjectGraphEdge,
  ProjectGraphNode,
  ProjectSource,
  SourceFragment,
} from "../../types";
import type {
  ImportPlan,
  KoraInventoryRecord,
  ProductionPackageVersion,
  ProjectBaseline,
  ReleaseArtifact,
} from "./contracts";

export interface FoundationEnvelope<T> {
  readonly contractVersion: "project-ceo-foundation/0.1";
  readonly requestId: string;
  readonly data: T | null;
  readonly error: {
    readonly code:
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
    readonly messageKey: string;
  } | null;
}

export interface SourceGraphIngestionPayload {
  readonly source: ProjectSource & {
    readonly sourceRevisionId: string;
    readonly packageId: string;
    readonly protectedMetadataRef: string;
  };
  readonly fragments: readonly SourceFragment[];
  readonly nodes: readonly ProjectGraphNode[];
  readonly revisions: readonly GraphNodeRevision[];
  readonly evidenceLinks: readonly EvidenceLink[];
  readonly edges: readonly ProjectGraphEdge[];
}

/**
 * Pure application boundary aligned to the frozen Foundation RPC surface.
 * Implementations derive actor, organization, project, package and server time
 * from trusted context and never expose private Project Intelligence relations.
 */
export interface ProjectBrainFoundationPort {
  registerSourceInventory(input: {
    readonly context: ProjectBrainActorContext;
    readonly records: readonly KoraInventoryRecord[];
    readonly importPlan: ImportPlan;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<ProjectBrainMutationResult<{ readonly registeredPhysicalRecords: number }>>;

  ingestSourceGraph(input: {
    readonly context: ProjectBrainActorContext;
    readonly payload: SourceGraphIngestionPayload;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<ProjectBrainMutationResult<{ readonly sourceRevisionId: string }>>;

  publishProjectBaseline(input: {
    readonly context: ProjectBrainHumanActorContext;
    readonly baseline: ProjectBaseline;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<ProjectBrainMutationResult<ProjectBaseline>>;

  publishProductionPackageVersion(input: {
    readonly context: ProjectBrainHumanActorContext;
    readonly productionPackage: ProductionPackageVersion;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<ProjectBrainMutationResult<ProductionPackageVersion>>;

  buildReleaseArtifact(input: {
    readonly context: ProjectBrainActorContext;
    readonly artifact: ReleaseArtifact;
    readonly idempotencyKey: string;
  }): Promise<ProjectBrainMutationResult<ReleaseArtifact>>;

  getProjectDelivery(input: {
    readonly context: ProjectBrainActorContext;
    readonly packageId: string | null;
  }): Promise<FoundationEnvelope<{
    readonly latestBaseline: ProjectBaseline | null;
    readonly packageVersions: readonly ProductionPackageVersion[];
    readonly releaseArtifacts: readonly ReleaseArtifact[];
  }>>;
}
