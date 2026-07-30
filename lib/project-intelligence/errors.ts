export const DOMAIN_ERROR_CODES = [
  "ai_claim_missing_evidence",
  "changed_node_missing",
  "current_revision_node_mismatch",
  "diff_project_mismatch",
  "duplicate_edge_id",
  "duplicate_evidence_id",
  "duplicate_fragment_id",
  "duplicate_node_id",
  "duplicate_review_id",
  "duplicate_review_target",
  "duplicate_revision_id",
  "duplicate_semantic_edge",
  "duplicate_snapshot_node",
  "duplicate_source_id",
  "duplicate_stable_key",
  "empty_locator_identifier",
  "invalid_claim_status",
  "invalid_graph_version_id",
  "invalid_locator_bbox",
  "invalid_locator_interval",
  "invalid_locator_page",
  "invalid_review_decision",
  "invalid_review_timestamp",
  "missing_current_revision",
  "missing_edge_node",
  "missing_evidence_fragment",
  "missing_evidence_revision",
  "missing_fragment_source",
  "missing_revision_node",
  "missing_review_revision",
  "project_mismatch",
  "review_actor_not_human",
  "review_target_mismatch",
  "review_target_not_current",
  "review_target_stale",
  "revision_immutability_violation",
  "revision_node_mismatch",
  "self_edge",
  "source_project_mismatch",
  "unknown_locator_kind",
  "unknown_missing_reason",
] as const;

export type DomainErrorCode = (typeof DOMAIN_ERROR_CODES)[number];

export interface DomainIssue {
  code: DomainErrorCode;
  entityId?: string;
  path?: string;
  message: string;
}

export type DomainResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: DomainIssue[] };

export class DomainContractError extends Error {
  readonly code: DomainErrorCode;
  readonly entityId?: string;
  readonly path?: string;

  constructor(issue: DomainIssue) {
    super(issue.message);
    this.name = "DomainContractError";
    this.code = issue.code;
    this.entityId = issue.entityId;
    this.path = issue.path;
  }
}
