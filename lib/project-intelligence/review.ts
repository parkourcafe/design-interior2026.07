import type { DomainIssue, DomainResult } from "./errors";
import type { ReviewRevisionInput, ReviewTransition } from "./types";

function failure(
  code: DomainIssue["code"],
  entityId: string,
  path: string,
  message: string,
): DomainResult<never> {
  return { ok: false, issues: [{ code, entityId, path, message }] };
}

function validIsoTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

export function reviewRevision(input: ReviewRevisionInput): DomainResult<ReviewTransition> {
  const actor = input.initiator.actor;
  if (input.initiator.kind !== "human_action" || actor.actorType !== "human" || !actor.actorId.trim()) {
    return failure(
      "review_actor_not_human",
      input.targetRevisionId,
      "/initiator/actor",
      "Only a caller-authenticated human action may create a human review.",
    );
  }

  if (input.targetRevisionId !== input.expectedRevisionId) {
    return failure(
      "review_target_mismatch",
      input.targetRevisionId,
      "/expectedRevisionId",
      "Target revision does not match the caller's expected revision.",
    );
  }

  const revision = input.snapshot.revisions.find(({ id }) => id === input.targetRevisionId);
  if (!revision) {
    return failure(
      "missing_review_revision",
      input.targetRevisionId,
      "/targetRevisionId",
      "Review target revision does not exist in the supplied snapshot.",
    );
  }

  const node = input.snapshot.nodes.find(({ id }) => id === revision.nodeId);
  if (!node || node.currentRevisionId !== input.expectedRevisionId) {
    return failure(
      "review_target_stale",
      input.targetRevisionId,
      "/expectedRevisionId",
      "Review target is no longer the node's current revision.",
    );
  }

  if (input.decision !== "confirmed" && input.decision !== "rejected") {
    return failure(
      "invalid_review_decision",
      input.targetRevisionId,
      "/decision",
      "Human review decision must be confirmed or rejected.",
    );
  }

  const requiresEvidence = revision.origin === "ai"
    && (revision.claimStatus === "extracted" || revision.claimStatus === "interpreted");
  if (requiresEvidence && !input.snapshot.evidenceLinks.some(({ nodeRevisionId }) => nodeRevisionId === revision.id)) {
    return failure(
      "ai_claim_missing_evidence",
      revision.id,
      `/revisions/${revision.id}`,
      "An AI-origin revision cannot be human-reviewed without revision-specific evidence.",
    );
  }

  if (input.snapshot.reviews.some(({ targetRevisionId }) => targetRevisionId === input.targetRevisionId)) {
    return failure(
      "duplicate_review_target",
      input.targetRevisionId,
      "/targetRevisionId",
      "The target revision already has a review in this snapshot.",
    );
  }

  if (!validIsoTimestamp(input.reviewedAt)) {
    return failure(
      "invalid_review_timestamp",
      input.targetRevisionId,
      "/reviewedAt",
      "Human review requires a server timestamp in ISO format with timezone.",
    );
  }

  return {
    ok: true,
    value: {
      targetRevision: revision,
      effectiveClaimStatus: input.decision === "confirmed" ? "human_confirmed" : "human_rejected",
      review: {
        id: input.reviewId,
        projectId: input.snapshot.projectId,
        targetRevisionId: input.targetRevisionId,
        decision: input.decision,
        actor: { id: actor.actorId, type: "human" },
        reviewedAt: input.reviewedAt,
      },
    },
  };
}
