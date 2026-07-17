import type {
  ApprovalPackage,
  DecisionRevision,
  PriceObservation,
  SelectionRevision,
} from "../../modules/decisions";
import type {
  ProductionPackageVersion,
  ProjectBaseline,
  ReleaseArtifact,
} from "../../modules/package";
import type {
  CommandMutation,
  FoundationEnvelope,
  PostgresRpcClient,
} from "./contracts";
import {
  parseCommandMutation,
  parseFoundationEnvelope,
} from "./contracts";
import { mapRpcError } from "./errors";

async function callProductRpc(
  client: PostgresRpcClient,
  functionName: string,
  args: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  const { data, error } = await client
    .schema("projectceo_product_api")
    .rpc(functionName, args);
  if (error) throw mapRpcError(error);
  return data;
}

export interface VersionScopedEvidenceInput {
  readonly evidenceVersionId: string;
  readonly evidenceLinkId: string;
  readonly sourceId: string;
  readonly sourceNodeId: string;
  readonly sourceRevisionId: string;
  readonly fragmentId: string;
}

export interface AppendDecisionRevisionInput {
  readonly projectId: string;
  readonly packageId: string;
  readonly nodeId: string;
  readonly revisionId: string;
  readonly expectedRevisionId: string | null;
  readonly claimStatus: DecisionRevision["claimStatus"];
  readonly title: string;
  readonly resolution: string;
  readonly areaNodeId: string | null;
  readonly decisionStatus: DecisionRevision["status"];
  readonly evidence: readonly VersionScopedEvidenceInput[];
  readonly reason: string;
  readonly expectedStateRevision: number;
  readonly idempotencyKey: string;
}

export interface AppendSelectionRevisionInput {
  readonly projectId: string;
  readonly packageId: string;
  readonly nodeId: string;
  readonly revisionId: string;
  readonly expectedRevisionId: string | null;
  readonly claimStatus: SelectionRevision["claimStatus"];
  readonly title: string;
  readonly areaNodeId: string;
  readonly decisionRevisionId: string;
  readonly specification: SelectionRevision["specification"];
  readonly evidence: readonly VersionScopedEvidenceInput[];
  readonly reason: string;
  readonly expectedStateRevision: number;
  readonly idempotencyKey: string;
}

export interface ProductRevisionMutation {
  readonly projectId: string;
  readonly packageId: string;
  readonly kind: "decision" | "selection";
  readonly nodeId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly replacesRevisionId: string | null;
}

export interface ReleaseDistributionMutation {
  readonly artifactId: string;
  readonly distributionId: string;
  readonly kind: "created" | "existing_distribution";
  readonly packageId: string;
  readonly productionPackageVersionId: string;
  readonly recipientUserId: string;
}

export interface ReleaseAcknowledgementMutation {
  readonly acknowledgementId: string;
  readonly distributionId: string;
  readonly packageId: string;
  readonly productionPackageVersionId: string;
  readonly semanticHash: `sha256:${string}`;
  readonly acknowledgedAt: string;
}

export interface ProductDeliveryProjection {
  readonly projectId: string;
  readonly package: Readonly<Record<string, unknown>> | null;
  readonly latestBaseline: ProjectBaseline | null;
  readonly packageVersions: readonly ProductionPackageVersion[];
  readonly releaseArtifacts: readonly ReleaseArtifact[];
  readonly distributions: readonly Readonly<Record<string, unknown>>[];
  readonly acknowledgements: readonly Readonly<Record<string, unknown>>[];
  readonly noChangeTerminals: readonly Readonly<Record<string, unknown>>[];
  readonly unresolvedImpactReviewCount: number;
  readonly extensionStatus: Readonly<Record<string, string>>;
}

/**
 * Authenticated-human adapter. It never accepts actor, organization, role or
 * timestamps; those values are derived in PostgreSQL from the request session.
 */
export class ProjectBrainHumanPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async appendDecisionRevision(
    input: AppendDecisionRevisionInput,
  ): Promise<CommandMutation<ProductRevisionMutation>> {
    return parseCommandMutation<ProductRevisionMutation>(
      await callProductRpc(this.client, "append_decision_revision", {
        project_id: input.projectId,
        package_id: input.packageId,
        node_id: input.nodeId,
        revision_id: input.revisionId,
        expected_revision_id: input.expectedRevisionId,
        claim_status: input.claimStatus,
        title: input.title,
        resolution: input.resolution,
        area_node_id: input.areaNodeId,
        decision_status: input.decisionStatus,
        evidence: input.evidence,
        reason: input.reason,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async appendSelectionRevision(
    input: AppendSelectionRevisionInput,
  ): Promise<CommandMutation<ProductRevisionMutation>> {
    return parseCommandMutation<ProductRevisionMutation>(
      await callProductRpc(this.client, "append_selection_revision", {
        project_id: input.projectId,
        package_id: input.packageId,
        node_id: input.nodeId,
        revision_id: input.revisionId,
        expected_revision_id: input.expectedRevisionId,
        claim_status: input.claimStatus,
        title: input.title,
        area_node_id: input.areaNodeId,
        decision_revision_id: input.decisionRevisionId,
        specification: input.specification,
        evidence: input.evidence,
        reason: input.reason,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async appendPriceObservation(input: {
    readonly projectId: string;
    readonly observation: Omit<PriceObservation, "observedAt">;
    readonly evidence: VersionScopedEvidenceInput;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<PriceObservation>> {
    return parseCommandMutation<PriceObservation>(
      await callProductRpc(this.client, "append_price_observation", {
        project_id: input.projectId,
        selection_revision_id: input.observation.selectionRevisionId,
        observation_id: input.observation.id,
        amount_rub: input.observation.amountRub,
        evidence: input.evidence,
        supplier_ref: input.observation.supplierRef,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async createApprovalPackage(input: {
    readonly projectId: string;
    readonly approvalPackage: Pick<
      ApprovalPackage,
      "id" | "packageId" | "items"
    >;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ApprovalPackage>> {
    return parseCommandMutation<ApprovalPackage>(
      await callProductRpc(this.client, "create_approval_package", {
        project_id: input.projectId,
        package_id: input.approvalPackage.packageId,
        approval_package_id: input.approvalPackage.id,
        items: input.approvalPackage.items,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async submitApprovalPackage(input: {
    readonly projectId: string;
    readonly approvalPackageId: string;
    readonly expectedStatus: "draft";
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ApprovalPackage>> {
    return parseCommandMutation<ApprovalPackage>(
      await callProductRpc(this.client, "submit_approval_package", {
        project_id: input.projectId,
        approval_package_id: input.approvalPackageId,
        expected_status: input.expectedStatus,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async reviewApprovalPackage(input: {
    readonly projectId: string;
    readonly approvalPackageId: string;
    readonly expectedStatus: "submitted";
    readonly decision: "approved" | "rejected" | "change_requested";
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ApprovalPackage>> {
    return parseCommandMutation<ApprovalPackage>(
      await callProductRpc(this.client, "review_approval_package", {
        project_id: input.projectId,
        approval_package_id: input.approvalPackageId,
        expected_status: input.expectedStatus,
        decision: input.decision,
        reason: input.reason,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async publishProjectBaseline(input: {
    readonly projectId: string;
    readonly descriptor: Readonly<Record<string, unknown>>;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ProjectBaseline>> {
    return parseCommandMutation<ProjectBaseline>(
      await callProductRpc(this.client, "publish_project_baseline", {
        project_id: input.projectId,
        descriptor: input.descriptor,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async publishProductionPackageVersion(input: {
    readonly projectId: string;
    readonly descriptor: Readonly<Record<string, unknown>>;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ProductionPackageVersion>> {
    return parseCommandMutation<ProductionPackageVersion>(
      await callProductRpc(
        this.client,
        "publish_production_package_version",
        {
          project_id: input.projectId,
          descriptor: input.descriptor,
          expected_state_revision: input.expectedStateRevision,
          idempotency_key: input.idempotencyKey,
        },
      ),
    );
  }

  async distributeRelease(input: {
    readonly projectId: string;
    readonly artifactId: string;
    readonly recipientUserId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ReleaseDistributionMutation>> {
    return parseCommandMutation<ReleaseDistributionMutation>(
      await callProductRpc(this.client, "distribute_release", {
        project_id: input.projectId,
        artifact_id: input.artifactId,
        recipient_user_id: input.recipientUserId,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async acknowledgeRelease(input: {
    readonly projectId: string;
    readonly distributionId: string;
    readonly expectedSemanticHash: `sha256:${string}`;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ReleaseAcknowledgementMutation>> {
    return parseCommandMutation<ReleaseAcknowledgementMutation>(
      await callProductRpc(this.client, "acknowledge_release", {
        project_id: input.projectId,
        distribution_id: input.distributionId,
        expected_semantic_hash: input.expectedSemanticHash,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async approveNoChange(input: {
    readonly projectId: string;
    readonly productionPackageVersionId: string;
    readonly baselineId: string;
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<Readonly<Record<string, unknown>>>> {
    return parseCommandMutation(
      await callProductRpc(this.client, "approve_no_change", {
        project_id: input.projectId,
        production_package_version_id:
          input.productionPackageVersionId,
        baseline_id: input.baselineId,
        reason: input.reason,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async getProjectDelivery(input: {
    readonly projectId: string;
    readonly packageId: string | null;
  }): Promise<FoundationEnvelope<ProductDeliveryProjection>> {
    const { data, error } = await this.client
      .schema("projectceo_api")
      .rpc("get_project_delivery", {
        project_id: input.projectId,
        package_id: input.packageId,
      });
    if (error) throw mapRpcError(error);
    return parseFoundationEnvelope<ProductDeliveryProjection>(data);
  }
}

/**
 * Worker-only adapter. The database ACL allows only fixed-system revision
 * extraction and deterministic logical-json release construction.
 */
export class ProjectBrainWorkerPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async appendSystemDecisionRevision(
    input: AppendDecisionRevisionInput,
  ): Promise<CommandMutation<ProductRevisionMutation>> {
    return parseCommandMutation<ProductRevisionMutation>(
      await callProductRpc(this.client, "append_system_decision_revision", {
        project_id: input.projectId,
        package_id: input.packageId,
        node_id: input.nodeId,
        revision_id: input.revisionId,
        expected_revision_id: input.expectedRevisionId,
        claim_status: input.claimStatus,
        title: input.title,
        resolution: input.resolution,
        area_node_id: input.areaNodeId,
        decision_status: input.decisionStatus,
        evidence: input.evidence,
        reason: input.reason,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async appendSystemSelectionRevision(
    input: AppendSelectionRevisionInput,
  ): Promise<CommandMutation<ProductRevisionMutation>> {
    return parseCommandMutation<ProductRevisionMutation>(
      await callProductRpc(this.client, "append_system_selection_revision", {
        project_id: input.projectId,
        package_id: input.packageId,
        node_id: input.nodeId,
        revision_id: input.revisionId,
        expected_revision_id: input.expectedRevisionId,
        claim_status: input.claimStatus,
        title: input.title,
        area_node_id: input.areaNodeId,
        decision_revision_id: input.decisionRevisionId,
        specification: input.specification,
        evidence: input.evidence,
        reason: input.reason,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async buildReleaseArtifact(input: {
    readonly projectId: string;
    readonly artifact: {
      readonly id: ReleaseArtifact["id"];
      readonly productionPackageVersionId:
        ReleaseArtifact["productionPackageVersionId"];
      readonly format: "logical_json";
      readonly semanticHash: ReleaseArtifact["semanticHash"];
    };
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<Readonly<Record<string, unknown>>>> {
    return parseCommandMutation(
      await callProductRpc(this.client, "build_release_artifact", {
        project_id: input.projectId,
        artifact: {
          artifactId: input.artifact.id,
          productionPackageVersionId:
            input.artifact.productionPackageVersionId,
          format: input.artifact.format,
          semanticHash: input.artifact.semanticHash,
        },
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }
}
