import type {
  ImpactDisposition,
  ImpactReasonCode,
  ImpactReview,
  ImpactRun,
  LogicalHandoff,
} from "../../application/change-handoff/types";
import type {
  WorkflowChangeReasonCode,
} from "../../application/workflow/contracts";
import type { JsonValue } from "../../types";
import type { CommandMutation, PostgresRpcClient } from "./contracts";
import { parseCommandMutation } from "./contracts";
import { callRpc } from "./rpc";

export interface Db2ReviewClaimResult {
  readonly stateRevision: number;
  readonly effectiveClaimStatus: "human_confirmed" | "human_rejected";
  readonly review: Readonly<Record<string, unknown>>;
}
export interface Db2PublishedVersion {
  readonly id: string;
  readonly projectId: string;
  readonly versionNo: number;
  readonly baseVersionId: string | null;
  readonly label: string | null;
  readonly graphDigest: `sha256:${string}`;
  readonly publishedAt: string;
  readonly publishedBy: {
    readonly actorId: string;
    readonly actorType: "human";
  };
}

export interface Db2PublishVersionResult {
  readonly stateRevision: number;
  readonly version: Db2PublishedVersion;
  readonly linkedChangeSetIds: readonly string[];
}

export interface Db2ReviseDecisionResult {
  readonly stateRevision: number;
  readonly revision: Readonly<Record<string, unknown>>;
  readonly review: Readonly<Record<string, unknown>>;
  readonly changeSet: Readonly<Record<string, unknown>>;
}

export interface ReviewClaimInput {
  readonly projectId: string;
  readonly targetRevisionId: string;
  readonly expectedRevisionId: string;
  readonly expectedStateRevision: number;
  readonly decision: "confirmed" | "rejected";
  readonly idempotencyKey: string;
}

export interface PublishVersionInput {
  readonly projectId: string;
  readonly expectedLatestVersionId: string | null;
  readonly expectedStateRevision: number;
  readonly label: string | null;
  readonly selectedRevisions: readonly {
    readonly nodeId: string;
    readonly revisionId: string;
  }[];
  readonly idempotencyKey: string;
}

export interface ReviseDecisionInput {
  readonly projectId: string;
  readonly nodeId: string;
  readonly baseVersionId: string;
  readonly expectedRevisionId: string;
  readonly expectedStateRevision: number;
  readonly title: string;
  readonly payload: JsonValue;
  readonly reasonCode: WorkflowChangeReasonCode;
  readonly protectedReason: string;
  readonly idempotencyKey: string;
}

/**
 * Request-bound adapter only. It cannot calculate impact or build a handoff,
 * because those RPCs are intentionally absent from this class.
 */
export class Db2HumanPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async reviewClaim(
    input: ReviewClaimInput,
  ): Promise<CommandMutation<Db2ReviewClaimResult>> {
    return parseCommandMutation(
      await callRpc(this.client, "project_intelligence_api", "review_claim", {
        project_id: input.projectId,
        target_revision_id: input.targetRevisionId,
        expected_revision_id: input.expectedRevisionId,
        expected_state_revision: input.expectedStateRevision,
        decision: input.decision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async publishVersion(
    input: PublishVersionInput,
  ): Promise<CommandMutation<Db2PublishVersionResult>> {
    return parseCommandMutation(
      await callRpc(this.client, "project_intelligence_api", "publish_version", {
        project_id: input.projectId,
        expected_latest_version_id: input.expectedLatestVersionId,
        expected_state_revision: input.expectedStateRevision,
        label: input.label,
        selected_revisions: input.selectedRevisions,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async reviseDecision(
    input: ReviseDecisionInput,
  ): Promise<CommandMutation<Db2ReviseDecisionResult>> {
    return parseCommandMutation(
      await callRpc(this.client, "project_intelligence_api", "revise_decision", {
        project_id: input.projectId,
        node_id: input.nodeId,
        base_version_id: input.baseVersionId,
        expected_revision_id: input.expectedRevisionId,
        expected_state_revision: input.expectedStateRevision,
        title: input.title,
        payload: input.payload,
        reason_code: input.reasonCode,
        protected_reason: input.protectedReason,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async reviewImpact(input: {
    readonly projectId: string;
    readonly impactRunId: string;
    readonly impactId: string;
    readonly expectedImpactStatus:
      | "needs_review"
      | "accepted"
      | "resolved"
      | "dismissed";
    readonly disposition: ImpactDisposition;
    readonly reasonCode: ImpactReasonCode;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ImpactReview & { readonly stateRevision: number }>> {
    return parseCommandMutation(
      await callRpc(this.client, "project_intelligence_api", "review_impact", {
        project_id: input.projectId,
        impact_run_id: input.impactRunId,
        impact_id: input.impactId,
        expected_impact_status: input.expectedImpactStatus,
        disposition: input.disposition,
        reason_code: input.reasonCode,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }
}

/**
 * Worker-only adapter. Its surface cannot perform any human approval, invitation,
 * membership or access-grant operation.
 */
export class Db2WorkerPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async calculateImpact(input: {
    readonly projectId: string;
    readonly changeSetId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<ImpactRun & { readonly stateRevision: number }>> {
    return parseCommandMutation(
      await callRpc(this.client, "project_intelligence_api", "calculate_impact", {
        project_id: input.projectId,
        change_set_id: input.changeSetId,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }

  async buildHandoff(input: {
    readonly projectId: string;
    readonly impactRunId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<LogicalHandoff & { readonly stateRevision: number }>> {
    return parseCommandMutation(
      await callRpc(this.client, "project_intelligence_api", "build_handoff", {
        project_id: input.projectId,
        impact_run_id: input.impactRunId,
        expected_state_revision: input.expectedStateRevision,
        idempotency_key: input.idempotencyKey,
      }),
    );
  }
}
