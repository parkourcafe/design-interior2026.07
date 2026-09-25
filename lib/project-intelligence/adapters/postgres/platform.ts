import type {
  CommandMutation,
  PostgresRpcClient,
} from "./contracts";
import { parseCommandMutation } from "./contracts";
import { callRpc } from "./rpc";

export interface PlatformProjectFactRecord {
  readonly factId: string;
  readonly factType: string;
  readonly content: Readonly<Record<string, unknown>>;
  readonly extractionKind: string;
  readonly sourceId: string | null;
  readonly sourceRevisionId: string | null;
  readonly statedReason: string | null;
  readonly createdAt: string;
  readonly supersededAt: string | null;
  readonly supersededBy: string | null;
}

export interface PlatformApprovalRequestRecord {
  readonly requestId: string;
  readonly subjectKind: string;
  readonly subjectId: string;
  readonly approverCapability: string;
  readonly status: string;
  readonly requestedByCurrentActor: boolean;
  readonly requestedReason: string;
  readonly selfApproved: boolean;
  readonly decidedBy: string | null;
  readonly decisionReason: string | null;
  readonly createdAt: string;
}

export interface PlatformProjectStageRevisionRecord {
  readonly stageId: string;
  readonly revisionId: string;
  readonly revisionNo: number;
  readonly resultRevisionId: string | null;
  readonly ownerUserId: string;
  readonly plannedAt: string | null;
  readonly actualAt: string | null;
  readonly blockerReason: string | null;
  readonly requirements: readonly unknown[];
  readonly approvalStatus: string | null;
  readonly approvalRevisionId: string | null;
  readonly notApplicableReason: string | null;
  readonly notApplicableBy: string | null;
  readonly createdAt: string;
}

type RecordValue = Readonly<Record<string, unknown>>;

function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function fact(value: unknown): PlatformProjectFactRecord | null {
  const item = record(value);
  const factId = text(item.factId);
  const factType = text(item.factType);
  const content = record(item.content);
  const extractionKind = text(item.extractionKind);
  const createdAt = text(item.createdAt);
  if (!factId || !factType || !extractionKind || !createdAt || !text(content.title)) return null;
  return {
    factId,
    factType,
    content,
    extractionKind,
    sourceId: text(item.sourceId),
    sourceRevisionId: text(item.sourceRevisionId),
    statedReason: text(item.statedReason),
    createdAt,
    supersededAt: text(item.supersededAt),
    supersededBy: text(item.supersededBy),
  };
}

function approval(value: unknown): PlatformApprovalRequestRecord | null {
  const item = record(value);
  const requestId = text(item.requestId);
  const subjectKind = text(item.subjectKind);
  const subjectId = text(item.subjectId);
  const approverCapability = text(item.approverCapability);
  const status = text(item.status);
  const requestedReason = text(item.requestedReason);
  const createdAt = text(item.createdAt);
  if (!requestId || !subjectKind || !subjectId || !approverCapability || !status || !requestedReason || !createdAt) return null;
  return {
    requestId,
    subjectKind,
    subjectId,
    approverCapability,
    status,
    requestedByCurrentActor: item.requestedByCurrentActor === true,
    requestedReason,
    selfApproved: item.selfApproved === true,
    decidedBy: text(item.decidedBy),
    decisionReason: text(item.decisionReason),
    createdAt,
  };
}

function stageRevision(value: unknown): PlatformProjectStageRevisionRecord | null {
  const item = record(value);
  const stageId = text(item.stageId);
  const revisionId = text(item.revisionId);
  const ownerUserId = text(item.ownerUserId);
  const createdAt = text(item.createdAt);
  const revisionNo = item.revisionNo;
  if (!stageId || !revisionId || !ownerUserId || !createdAt || typeof revisionNo !== "number" || !Number.isSafeInteger(revisionNo) || revisionNo < 1) return null;
  return {
    stageId, revisionId, revisionNo,
    resultRevisionId: text(item.resultRevisionId), ownerUserId,
    plannedAt: text(item.plannedAt), actualAt: text(item.actualAt), blockerReason: text(item.blockerReason),
    requirements: Array.isArray(item.requirements) ? item.requirements : [],
    approvalStatus: text(item.approvalStatus), approvalRevisionId: text(item.approvalRevisionId),
    notApplicableReason: text(item.notApplicableReason), notApplicableBy: text(item.notApplicableBy), createdAt,
  };
}

export class ProjectCeoPlatformPostgresAdapter {
  constructor(private readonly client: PostgresRpcClient) {}

  async listProjectFacts(projectId: string): Promise<readonly PlatformProjectFactRecord[]> {
    const data = record(await callRpc(
      this.client,
      "projectceo_platform_api",
      "list_project_facts",
      { p_project_id: projectId, p_include_superseded: true },
    ));
    return Array.isArray(data.facts)
      ? data.facts.flatMap((value) => {
          const item = fact(value);
          return item ? [item] : [];
        })
      : [];
  }

  async listApprovalRequests(projectId: string): Promise<readonly PlatformApprovalRequestRecord[]> {
    const data = record(await callRpc(
      this.client,
      "projectceo_platform_api",
      "list_approval_requests",
      { p_project_id: projectId, p_status: null },
    ));
    return Array.isArray(data.requests)
      ? data.requests.flatMap((value) => {
          const item = approval(value);
          return item ? [item] : [];
        })
      : [];
  }

  async listProjectStageRevisions(projectId: string): Promise<readonly PlatformProjectStageRevisionRecord[]> {
    const data = record(await callRpc(this.client, "projectceo_platform_api", "get_project_stage_revisions", { project_id: projectId }));
    return Array.isArray(data.stages) ? data.stages.flatMap((value) => {
      const item = stageRevision(value);
      return item ? [item] : [];
    }) : [];
  }

  async recordProjectStageRevision(input: {
    readonly projectId: string; readonly stageId: string; readonly resultRevisionId: string | null;
    readonly ownerUserId: string; readonly plannedAt: string | null; readonly actualAt: string | null;
    readonly blockerReason: string | null; readonly requirements: readonly unknown[];
    readonly approvalStatus: string | null; readonly approvalRevisionId: string | null;
    readonly notApplicableReason: string | null; readonly expectedStateRevision: number; readonly idempotencyKey: string;
  }): Promise<CommandMutation<unknown>> {
    return parseCommandMutation(await callRpc(this.client, "projectceo_platform_api", "record_project_stage_revision", {
      project_id: input.projectId, stage_id: input.stageId, result_revision_id: input.resultRevisionId,
      owner_user_id: input.ownerUserId, planned_at: input.plannedAt, actual_at: input.actualAt,
      blocker_reason: input.blockerReason, requirements: input.requirements, approval_status: input.approvalStatus,
      approval_revision_id: input.approvalRevisionId, not_applicable_reason: input.notApplicableReason,
      expected_state_revision: input.expectedStateRevision, idempotency_key: input.idempotencyKey,
    }));
  }

  async createProjectFact(input: {
    readonly projectId: string;
    readonly factType: string;
    readonly content: Readonly<Record<string, unknown>>;
    readonly extractionKind: string;
    readonly sourceId: string | null;
    readonly sourceRevisionId: string | null;
    readonly statedReason: string | null;
    readonly supersedesFactId: string | null;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<unknown>> {
    return parseCommandMutation(await callRpc(
      this.client,
      "projectceo_platform_api",
      "create_project_fact",
      {
        p_project_id: input.projectId,
        p_fact_type: input.factType,
        p_content: input.content,
        p_extraction_kind: input.extractionKind,
        p_source_id: input.sourceId,
        p_source_revision_id: input.sourceRevisionId,
        p_stated_reason: input.statedReason,
        p_supersedes_fact_id: input.supersedesFactId,
        p_expected_state_revision: input.expectedStateRevision,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
  }

  async createApprovalRequest(input: {
    readonly projectId: string;
    readonly subjectKind: string;
    readonly subjectId: string;
    readonly approverCapability: string;
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<unknown>> {
    return parseCommandMutation(await callRpc(
      this.client,
      "projectceo_platform_api",
      "create_approval_request",
      {
        p_project_id: input.projectId,
        p_subject_kind: input.subjectKind,
        p_subject_id: input.subjectId,
        p_approver_capability: input.approverCapability,
        p_reason: input.reason,
        p_expected_state_revision: input.expectedStateRevision,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
  }

  async submitApprovalRequest(input: {
    readonly projectId: string;
    readonly requestId: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<unknown>> {
    return parseCommandMutation(await callRpc(
      this.client,
      "projectceo_platform_api",
      "submit_approval_request",
      {
        p_project_id: input.projectId,
        p_request_id: input.requestId,
        p_expected_state_revision: input.expectedStateRevision,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
  }

  async decideApprovalRequest(input: {
    readonly projectId: string;
    readonly requestId: string;
    readonly decision: "approved" | "rejected";
    readonly reason: string;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<CommandMutation<unknown>> {
    return parseCommandMutation(await callRpc(
      this.client,
      "projectceo_platform_api",
      "decide_approval_request",
      {
        p_project_id: input.projectId,
        p_request_id: input.requestId,
        p_decision: input.decision,
        p_reason: input.reason,
        p_expected_state_revision: input.expectedStateRevision,
        p_idempotency_key: input.idempotencyKey,
      },
    ));
  }
}
