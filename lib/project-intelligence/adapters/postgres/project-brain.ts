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

export interface M2WorkspaceRevisionMutation {
  readonly entityKind:
    | "room"
    | "variant"
    | "material"
    | "budget"
    | "client_handoff"
    | "approved_commit"
    | "layout_version";
  readonly entityId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly packageId: string;
  readonly status: "draft" | "submitted" | "approved" | "published";
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

  async appendM2WorkspaceRevision(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly entityKind: M2WorkspaceRevisionMutation["entityKind"];
    readonly entityId: string;
    readonly revisionId: string;
    readonly expectedRevisionId: string | null;
    readonly status: M2WorkspaceRevisionMutation["status"];
    readonly payload: Readonly<Record<string, unknown>>;
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<M2WorkspaceRevisionMutation>> {
    return parseCommandMutation<M2WorkspaceRevisionMutation>(
      await callProductRpc(this.client, "append_m2_workspace_revision", {
        project_id: input.projectId,
        package_id: input.packageId,
        entity_kind: input.entityKind,
        entity_id: input.entityId,
        revision_id: input.revisionId,
        expected_revision_id: input.expectedRevisionId,
        status: input.status,
        payload: input.payload,
        reason: input.reason,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async submitM2ClientReview(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly submissionId: string;
    readonly revisionId: string;
    readonly expectedRevisionId: string | null;
    readonly approvalPackageId: string;
    readonly roomId: string;
    readonly designIntentRevisionId: string;
    readonly variants: readonly Readonly<Record<string, unknown>>[];
    readonly budgetAsOf: string;
    readonly staleAfterDays: number;
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<Readonly<Record<string, unknown>>>> {
    return parseCommandMutation(await callProductRpc(this.client, "submit_m2_client_review", {
      project_id: input.projectId,
      package_id: input.packageId,
      submission_id: input.submissionId,
      revision_id: input.revisionId,
      expected_revision_id: input.expectedRevisionId,
      approval_package_id: input.approvalPackageId,
      room_id: input.roomId,
      design_intent_revision_id: input.designIntentRevisionId,
      variants: input.variants,
      budget_as_of: input.budgetAsOf,
      stale_after_days: input.staleAfterDays,
      reason: input.reason,
      expected_state_revision: input.expectedStateRevision,
      idempotency_key: input.idempotencyKey,
    }));
  }

  async reviewM2ClientSubmission(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly submissionId: string;
    readonly revisionId: string;
    readonly expectedRevisionId: string;
    readonly chosenVariantId: string;
    readonly decision: "approved" | "rejected" | "change_requested";
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<Readonly<Record<string, unknown>>>> {
    return parseCommandMutation(await callProductRpc(this.client, "review_m2_client_submission", {
      project_id: input.projectId,
      package_id: input.packageId,
      submission_id: input.submissionId,
      revision_id: input.revisionId,
      expected_revision_id: input.expectedRevisionId,
      chosen_variant_id: input.chosenVariantId,
      decision: input.decision,
      reason: input.reason,
      expected_state_revision: input.expectedStateRevision,
      idempotency_key: input.idempotencyKey,
    }));
  }

  async publishM2M3Handoff(input: {
    readonly projectId: string;
    readonly packageId: string;
    readonly handoffId: string;
    readonly revisionId: string;
    readonly expectedRevisionId: string | null;
    readonly approvedCommitId: string;
    readonly approvedCommitRevisionId: string;
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<Readonly<Record<string, unknown>>>> {
    return parseCommandMutation(await callProductRpc(this.client, "publish_m2_m3_handoff", {
      project_id: input.projectId,
      package_id: input.packageId,
      handoff_id: input.handoffId,
      revision_id: input.revisionId,
      expected_revision_id: input.expectedRevisionId,
      approved_commit_id: input.approvedCommitId,
      approved_commit_revision_id: input.approvedCommitRevisionId,
      reason: input.reason,
      expected_state_revision: input.expectedStateRevision,
      idempotency_key: input.idempotencyKey,
    }));
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

  /**
   * Request-bound M3 baseline publication. The database derives the version
   * snapshot and baseline descriptor in one transaction; the application only
   * presents coordinates it obtained from the server-owned preview.
   */
  async publishBaselineAtomic(input: {
    readonly projectId: string;
    readonly expectedLatestVersionId: string | null;
    readonly previousBaselineId: string | null;
    readonly expectedStateRevision: number;
    readonly commandRef: string;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<Readonly<Record<string, unknown>>>> {
    return parseCommandMutation<Readonly<Record<string, unknown>>>(
      await callProductRpc(this.client, "publish_baseline_atomic", {
        project_id: input.projectId,
        expected_latest_version_id: input.expectedLatestVersionId,
        previous_baseline_id: input.previousBaselineId,
        expected_state_revision: input.expectedStateRevision,
        command_ref: input.commandRef,
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

  async publishReleaseRequestBound(input: {
    readonly projectId: string;
    readonly expectedBaselineId: string;
    readonly expectedPreviousVersionId: string | null;
    readonly expectedStateRevision: number;
    readonly commandRef: string;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ProductionPackageVersion>> {
    return parseCommandMutation<ProductionPackageVersion>(
      await callProductRpc(this.client, "publish_release_request_bound", {
        project_id: input.projectId,
        expected_baseline_id: input.expectedBaselineId,
        expected_previous_version_id: input.expectedPreviousVersionId,
        expected_state_revision: input.expectedStateRevision,
        command_ref: input.commandRef,
        idempotency_key: input.idempotencyKey,
      }),
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

  async distributeReleaseRequestBound(input: {
    readonly projectId: string;
    readonly artifactId: string;
    readonly recipientUserId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ReleaseDistributionMutation>> {
    return parseCommandMutation<ReleaseDistributionMutation>(
      await callProductRpc(
        this.client,
        "distribute_release_request_bound",
        {
          project_id: input.projectId,
          artifact_id: input.artifactId,
          recipient_user_id: input.recipientUserId,
          expected_state_revision: input.expectedStateRevision,
          idempotency_key: input.idempotencyKey,
        },
      ),
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

  async acknowledgeReleaseRequestBound(input: {
    readonly projectId: string;
    readonly distributionId: string;
    readonly expectedSemanticHash: `sha256:${string}`;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ReleaseAcknowledgementMutation>> {
    return parseCommandMutation<ReleaseAcknowledgementMutation>(
      await callProductRpc(
        this.client,
        "acknowledge_release_request_bound",
        {
          project_id: input.projectId,
          distribution_id: input.distributionId,
          expected_semantic_hash: input.expectedSemanticHash,
          expected_state_revision: input.expectedStateRevision,
          idempotency_key: input.idempotencyKey,
        },
      ),
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

  /**
   * Очередь выпущенных версий без артефакта — системное чтение
   * (`20260811030000`, права только у service role). Разбор конверта живёт в
   * воркере: адаптер отвечает за границу с базой, а не за контракт очереди.
   */
  async listReleaseArtifactBacklog(input: {
    readonly maxRows: number;
  }): Promise<unknown> {
    return callProductRpc(this.client, "list_release_artifact_backlog", {
      max_rows: input.maxRows,
    });
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
