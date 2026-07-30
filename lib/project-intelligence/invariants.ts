import type { DomainIssue } from "./errors";
import { validateSourceLocator } from "./locator";
import { compareCodePoints } from "./ordering";
import {
  HUMAN_REVIEW_DECISIONS,
  REVISION_CLAIM_STATUSES,
  type ProjectGraphSnapshot,
} from "./types";

export type GraphInvariantCode = DomainIssue["code"];
export type GraphInvariantIssue = DomainIssue;

function duplicateIds(ids: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return duplicates;
}

function pushIssue(
  issues: DomainIssue[],
  code: DomainIssue["code"],
  entityId: string,
  path: string,
  message: string,
): void {
  issues.push({ code, entityId, path, message });
}

function validIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function issueOrder(left: DomainIssue, right: DomainIssue): number {
  return compareCodePoints(left.code, right.code)
    || compareCodePoints(left.entityId ?? "", right.entityId ?? "")
    || compareCodePoints(left.path ?? "", right.path ?? "");
}

function uniqueIssues(issues: DomainIssue[]): DomainIssue[] {
  const unique = new Map<string, DomainIssue>();
  for (const item of issues) {
    const key = `${item.code}\u0000${item.entityId ?? ""}\u0000${item.path ?? ""}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

export function validateProjectGraphSnapshot(snapshot: ProjectGraphSnapshot): GraphInvariantIssue[] {
  const issues: DomainIssue[] = [];

  if (!snapshot.versionId?.trim()) {
    pushIssue(issues, "invalid_graph_version_id", snapshot.projectId, "/versionId", "Graph snapshot requires an exact version ID.");
  }

  const duplicateGroups: Array<[
    readonly string[],
    DomainIssue["code"],
    string,
  ]> = [
    [snapshot.sources.map(({ id }) => id), "duplicate_source_id", "/sources"],
    [snapshot.sourceFragments.map(({ id }) => id), "duplicate_fragment_id", "/sourceFragments"],
    [snapshot.nodes.map(({ id }) => id), "duplicate_node_id", "/nodes"],
    [snapshot.revisions.map(({ id }) => id), "duplicate_revision_id", "/revisions"],
    [snapshot.reviews.map(({ id }) => id), "duplicate_review_id", "/reviews"],
    [snapshot.evidenceLinks.map(({ id }) => id), "duplicate_evidence_id", "/evidenceLinks"],
    [snapshot.edges.map(({ id }) => id), "duplicate_edge_id", "/edges"],
  ];

  for (const [ids, code, path] of duplicateGroups) {
    for (const id of duplicateIds(ids)) {
      pushIssue(issues, code, id, `${path}/${id}`, `Duplicate domain identity: ${id}.`);
    }
  }

  const sources = new Map(snapshot.sources.map((source) => [source.id, source]));
  const fragments = new Map(snapshot.sourceFragments.map((fragment) => [fragment.id, fragment]));
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const revisions = new Map(snapshot.revisions.map((revision) => [revision.id, revision]));

  for (const source of snapshot.sources) {
    if (source.projectId !== snapshot.projectId) {
      pushIssue(issues, "project_mismatch", source.id, `/sources/${source.id}/projectId`, `Source ${source.id} belongs to another project.`);
    }
  }

  for (const fragment of snapshot.sourceFragments) {
    if (fragment.projectId !== snapshot.projectId) {
      pushIssue(issues, "project_mismatch", fragment.id, `/sourceFragments/${fragment.id}/projectId`, `Fragment ${fragment.id} belongs to another project.`);
    }
    const source = sources.get(fragment.sourceId);
    if (!source) {
      pushIssue(issues, "missing_fragment_source", fragment.id, `/sourceFragments/${fragment.id}/sourceId`, `Fragment ${fragment.id} references a missing source.`);
    } else if (source.projectId !== fragment.projectId) {
      pushIssue(issues, "source_project_mismatch", fragment.id, `/sourceFragments/${fragment.id}/sourceId`, `Fragment ${fragment.id} and its source belong to different projects.`);
    }
    const locatorResult = validateSourceLocator(fragment.locator);
    if (!locatorResult.ok) {
      for (const locatorIssue of locatorResult.issues) {
        issues.push({
          ...locatorIssue,
          entityId: fragment.id,
          path: `/sourceFragments/${fragment.id}/locator${locatorIssue.path ?? ""}`,
        });
      }
    }
  }

  const stableKeys = new Set<string>();
  for (const node of snapshot.nodes) {
    if (node.projectId !== snapshot.projectId) {
      pushIssue(issues, "project_mismatch", node.id, `/nodes/${node.id}/projectId`, `Node ${node.id} belongs to another project.`);
    }
    const stableKey = `${node.kind}\u0000${node.stableKey}`;
    if (stableKeys.has(stableKey)) {
      pushIssue(issues, "duplicate_stable_key", node.id, `/nodes/${node.id}/stableKey`, `Stable key ${node.stableKey} is duplicated for ${node.kind}.`);
    }
    stableKeys.add(stableKey);

    const currentRevision = revisions.get(node.currentRevisionId);
    if (!currentRevision) {
      pushIssue(issues, "missing_current_revision", node.id, `/nodes/${node.id}/currentRevisionId`, `Node ${node.id} references a missing current revision.`);
    } else if (currentRevision.nodeId !== node.id) {
      pushIssue(issues, "current_revision_node_mismatch", node.id, `/nodes/${node.id}/currentRevisionId`, `Current revision does not belong to node ${node.id}.`);
    }
  }

  for (const revision of snapshot.revisions) {
    if (revision.projectId !== snapshot.projectId) {
      pushIssue(issues, "project_mismatch", revision.id, `/revisions/${revision.id}/projectId`, `Revision ${revision.id} belongs to another project.`);
    }
    const node = nodes.get(revision.nodeId);
    if (!node) {
      pushIssue(issues, "missing_revision_node", revision.id, `/revisions/${revision.id}/nodeId`, `Revision ${revision.id} references a missing stable node.`);
    } else if (node.projectId !== revision.projectId) {
      pushIssue(issues, "revision_node_mismatch", revision.id, `/revisions/${revision.id}/nodeId`, `Revision ${revision.id} and its node belong to different projects.`);
    }
    if (!(REVISION_CLAIM_STATUSES as readonly string[]).includes(revision.claimStatus)) {
      pushIssue(issues, "invalid_claim_status", revision.id, `/revisions/${revision.id}/claimStatus`, `Revision ${revision.id} has an invalid base claim status.`);
    }
    if (revision.claimStatus === "unknown" && !revision.unknownReason?.trim()) {
      pushIssue(issues, "unknown_missing_reason", revision.id, `/revisions/${revision.id}/unknownReason`, `Unknown revision ${revision.id} requires a reason.`);
    }
  }

  const evidenceCount = new Map<string, number>();
  for (const link of snapshot.evidenceLinks) {
    if (link.projectId !== snapshot.projectId) {
      pushIssue(issues, "project_mismatch", link.id, `/evidenceLinks/${link.id}/projectId`, `Evidence ${link.id} belongs to another project.`);
    }
    if (!revisions.has(link.nodeRevisionId)) {
      pushIssue(issues, "missing_evidence_revision", link.id, `/evidenceLinks/${link.id}/nodeRevisionId`, `Evidence ${link.id} references a missing revision.`);
    } else {
      evidenceCount.set(link.nodeRevisionId, (evidenceCount.get(link.nodeRevisionId) ?? 0) + 1);
    }
    if (!fragments.has(link.sourceFragmentId)) {
      pushIssue(issues, "missing_evidence_fragment", link.id, `/evidenceLinks/${link.id}/sourceFragmentId`, `Evidence ${link.id} references a missing fragment.`);
    }
  }

  for (const revision of snapshot.revisions) {
    const needsEvidence = revision.origin === "ai"
      && (revision.claimStatus === "extracted" || revision.claimStatus === "interpreted");
    if (needsEvidence && !evidenceCount.get(revision.id)) {
      pushIssue(issues, "ai_claim_missing_evidence", revision.id, `/revisions/${revision.id}`, `AI revision ${revision.id} requires source evidence.`);
    }
  }

  const reviewedRevisions = new Set<string>();
  for (const review of snapshot.reviews) {
    if (review.projectId !== snapshot.projectId) {
      pushIssue(issues, "project_mismatch", review.id, `/reviews/${review.id}/projectId`, `Review ${review.id} belongs to another project.`);
    }
    const revision = revisions.get(review.targetRevisionId);
    if (!revision) {
      pushIssue(issues, "missing_review_revision", review.id, `/reviews/${review.id}/targetRevisionId`, `Review ${review.id} references a missing revision.`);
    } else if (nodes.get(revision.nodeId)?.currentRevisionId !== revision.id) {
      pushIssue(issues, "review_target_not_current", review.id, `/reviews/${review.id}/targetRevisionId`, `Review ${review.id} targets a stale revision.`);
    }
    if (reviewedRevisions.has(review.targetRevisionId)) {
      pushIssue(issues, "duplicate_review_target", review.id, `/reviews/${review.id}/targetRevisionId`, `Revision ${review.targetRevisionId} has more than one review in this snapshot.`);
    }
    reviewedRevisions.add(review.targetRevisionId);
    if (review.actor?.type !== "human" || !review.actor.id?.trim()) {
      pushIssue(issues, "review_actor_not_human", review.id, `/reviews/${review.id}/actor`, `Human review ${review.id} requires a human actor.`);
    }
    if (!(HUMAN_REVIEW_DECISIONS as readonly string[]).includes(review.decision)) {
      pushIssue(issues, "invalid_review_decision", review.id, `/reviews/${review.id}/decision`, `Review ${review.id} has an invalid decision.`);
    }
    if (!validIsoTimestamp(review.reviewedAt)) {
      pushIssue(issues, "invalid_review_timestamp", review.id, `/reviews/${review.id}/reviewedAt`, `Review ${review.id} requires an ISO timestamp with timezone.`);
    }
  }

  const semanticEdges = new Set<string>();
  for (const edge of snapshot.edges) {
    if (edge.projectId !== snapshot.projectId) {
      pushIssue(issues, "project_mismatch", edge.id, `/edges/${edge.id}/projectId`, `Edge ${edge.id} belongs to another project.`);
    }
    const from = nodes.get(edge.fromNodeId);
    const to = nodes.get(edge.toNodeId);
    if (!from || !to) {
      pushIssue(issues, "missing_edge_node", edge.id, `/edges/${edge.id}`, `Edge ${edge.id} references a missing node.`);
      continue;
    }
    if (from.projectId !== snapshot.projectId || to.projectId !== snapshot.projectId) {
      pushIssue(issues, "project_mismatch", edge.id, `/edges/${edge.id}`, `Edge ${edge.id} crosses a project boundary.`);
    }
    if (edge.fromNodeId === edge.toNodeId) {
      pushIssue(issues, "self_edge", edge.id, `/edges/${edge.id}`, `Edge ${edge.id} references the same node twice.`);
    }
    const semanticKey = `${edge.fromNodeId}\u0000${edge.toNodeId}\u0000${edge.relation}`;
    if (semanticEdges.has(semanticKey)) {
      pushIssue(issues, "duplicate_semantic_edge", edge.id, `/edges/${edge.id}`, `Edge ${edge.id} duplicates an active semantic edge.`);
    }
    semanticEdges.add(semanticKey);
  }

  return uniqueIssues(issues).sort(issueOrder);
}
