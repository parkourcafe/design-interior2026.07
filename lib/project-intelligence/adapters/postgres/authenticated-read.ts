import type { PostgresRpcClient } from "./contracts";
import type { ExecutionDeliveryEnvelope } from "./execution";
import { callRpc } from "./rpc";

export const AUTHENTICATED_READ_CONTRACT_VERSION =
  "project-ceo-authenticated-read/0.1" as const;

export interface AuthenticatedReadEvidence {
  readonly evidenceLinkId: string;
  readonly evidenceVersionId: string;
  readonly fragmentId: string;
  readonly locator: Readonly<Record<string, unknown>>;
  readonly locatorKind: string;
  readonly sourceId: string;
  readonly sourceRevisionId: string;
}

export interface AuthenticatedReadRevisionHistory {
  readonly reason: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly status: "current" | "superseded";
}

export interface AuthenticatedReadDecision {
  readonly areaNodeId: string | null;
  readonly claimStatus: "extracted" | "interpreted" | "unknown" | "human_origin";
  readonly evidence: readonly AuthenticatedReadEvidence[];
  readonly id: string;
  readonly packageId: string;
  readonly resolution: string;
  readonly revisionHistory: readonly AuthenticatedReadRevisionHistory[];
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly reviewStatus: "submitted" | "approved" | "change_requested";
  readonly title: string;
}

export interface AuthenticatedReadSelection {
  readonly area: string;
  readonly areaNodeId: string;
  readonly claimStatus: "extracted" | "interpreted" | "unknown" | "human_origin";
  readonly decisionRevisionId: string;
  readonly evidence: readonly AuthenticatedReadEvidence[];
  readonly id: string;
  readonly packageId: string;
  readonly priceObservation: {
    readonly amountRub: number;
    readonly checkedAt: string;
    readonly sourceId: string;
    readonly sourceRevisionId: string;
  } | null;
  readonly revisionHistory: readonly AuthenticatedReadRevisionHistory[];
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly reviewStatus: "draft" | "submitted" | "approved" | "rejected" | "change_requested";
  readonly specification: Readonly<Record<string, unknown>>;
  readonly title: string;
}

export interface AuthenticatedReadSource {
  readonly availability: "materialized" | "placeholder";
  readonly checksum: string | null;
  readonly disciplineKey: string;
  readonly documentStatus: "current" | "previous" | "reference" | "unknown";
  readonly floorKey: string;
  readonly id: string;
  readonly kind: string | null;
  readonly logicalSourceId: string | null;
  readonly mediaType: string | null;
  readonly packageId: string;
  readonly reviewStatus: "pending" | "confirmed" | "rejected";
  readonly reviewTargetRevisionId: string | null;
  readonly sanitizedName: string;
  readonly semanticConflict: boolean;
  readonly sizeBytes: number | null;
  readonly sourceRevisionId: string | null;
  readonly sourceRole: string | null;
  readonly zoneKey: string;
}

export interface AuthenticatedReadSourceStats {
  readonly duplicateGroups: number;
  readonly materializedRecords: number;
  readonly physicalRecords: number;
  readonly placeholders: number;
  readonly quarantinedGroups: number;
  readonly reviewQueue: number;
  readonly uniqueBlobs: number;
}

export interface AuthenticatedReadDistributionSummary {
  readonly acknowledgementCount: number;
  readonly packageId: string;
  readonly productionPackageVersionId: string;
  readonly recipientCount: number;
}

export interface AuthenticatedReadRecipientDistribution {
  readonly acknowledged: boolean;
  readonly acknowledgedAt: string | null;
  readonly artifactId: string;
  readonly distributedAt: string;
  readonly distributionId: string;
  readonly packageId: string;
  readonly productionPackageVersionId: string;
  readonly semanticHash: `sha256:${string}`;
}

export interface AuthenticatedReadReleaseRecipient {
  readonly packageId: string | null;
  readonly role: "owner_lead" | "architect" | "builder" | "client_approver";
  readonly scope: "project" | "package";
  readonly userId: string;
}

export interface AuthenticatedProjectReadProjection {
  readonly approvalPackages: readonly Readonly<Record<string, unknown>>[];
  readonly decisions: readonly AuthenticatedReadDecision[];
  readonly distributionSummary: readonly AuthenticatedReadDistributionSummary[];
  readonly executionPackages: readonly ExecutionDeliveryEnvelope[];
  readonly extensionStatus: Readonly<Record<string, string>>;
  readonly latestBaseline: Readonly<Record<string, unknown>> | null;
  readonly noChangeTerminals: readonly Readonly<Record<string, unknown>>[];
  readonly packages: readonly Readonly<Record<string, unknown>>[];
  readonly packageVersions: readonly Readonly<Record<string, unknown>>[];
  readonly projectMetadata: {
    readonly areaM2: number;
    readonly location: string;
    readonly model: "full_project";
    readonly name: string;
  };
  readonly recipientDistributions: readonly AuthenticatedReadRecipientDistribution[];
  readonly releaseArtifacts: readonly Readonly<Record<string, unknown>>[];
  readonly releaseRecipients: readonly AuthenticatedReadReleaseRecipient[];
  readonly reviewQueue: readonly Readonly<Record<string, unknown>>[];
  readonly selections: readonly AuthenticatedReadSelection[];
  readonly sourceStats: AuthenticatedReadSourceStats;
  readonly sources: readonly AuthenticatedReadSource[];
  readonly unresolvedImpactReviewCount: number;
}

export interface AuthenticatedProjectReadEnvelope {
  readonly contractVersion: typeof AUTHENTICATED_READ_CONTRACT_VERSION;
  readonly requestId: string;
  readonly data: AuthenticatedProjectReadProjection;
  readonly error: null;
  readonly scope: {
    readonly accessScope: "project" | "package";
    readonly actorUserId: string;
    readonly organizationId: string;
    readonly packageId: string | null;
    readonly projectId: string;
  };
  readonly stateRevision: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseAuthenticatedProjectRead(value: unknown): AuthenticatedProjectReadEnvelope {
  if (!isRecord(value) || !isRecord(value.data) || !isRecord(value.scope)) {
    throw new Error("Invalid ProjectCEO authenticated read envelope");
  }
  const data = value.data;
  const scope = value.scope;
  const projectMetadata = isRecord(data.projectMetadata)
    ? data.projectMetadata
    : null;
  const arrayKeys = [
    "approvalPackages",
    "decisions",
    "distributionSummary",
    "executionPackages",
    "noChangeTerminals",
    "packages",
    "packageVersions",
    "recipientDistributions",
    "releaseArtifacts",
    "releaseRecipients",
    "reviewQueue",
    "selections",
    "sources",
  ] as const;
  const validArrays = arrayKeys.every((key) => Array.isArray(data[key]));
  const validScope = isUuid(scope.actorUserId)
    && isUuid(scope.organizationId)
    && isUuid(scope.projectId)
    && (scope.packageId === null || isUuid(scope.packageId))
    && (scope.accessScope === "project" || scope.accessScope === "package");
  if (
    value.contractVersion !== AUTHENTICATED_READ_CONTRACT_VERSION
    || typeof value.requestId !== "string"
    || value.requestId.length === 0
    || value.error !== null
    || !validArrays
    || !validScope
    || !isRecord(data.extensionStatus)
    || projectMetadata === null
    || typeof projectMetadata.name !== "string"
    || typeof projectMetadata.location !== "string"
    || projectMetadata.model !== "full_project"
    || typeof projectMetadata.areaM2 !== "number"
    || !Number.isSafeInteger(projectMetadata.areaM2)
    || projectMetadata.areaM2 < 0
    || !isRecord(data.sourceStats)
    || typeof data.unresolvedImpactReviewCount !== "number"
    || !Number.isSafeInteger(data.unresolvedImpactReviewCount)
    || data.unresolvedImpactReviewCount < 0
    || typeof value.stateRevision !== "number"
    || !Number.isSafeInteger(value.stateRevision)
    || value.stateRevision < 0
  ) {
    throw new Error("Invalid ProjectCEO authenticated read envelope");
  }
  return value as unknown as AuthenticatedProjectReadEnvelope;
}

/** Authenticated, request-bound and read-only AP1 projection. */
export class ProjectCeoAuthenticatedReadPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async getProjectWorkspaceRead(input: {
    readonly projectId: string;
    readonly packageId: string | null;
  }): Promise<AuthenticatedProjectReadEnvelope> {
    return parseAuthenticatedProjectRead(
      await callRpc(
        this.client,
        "projectceo_read_api",
        "get_project_workspace_read",
        {
          project_id: input.projectId,
          package_id: input.packageId,
        },
      ),
    );
  }
}
