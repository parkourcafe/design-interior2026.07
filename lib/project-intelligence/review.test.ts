import { describe, expect, it } from "vitest";
import { reviewRevision } from "./review";
import type { ProjectGraphSnapshot, ReviewRevisionInput } from "./types";

function reviewableSnapshot(): ProjectGraphSnapshot {
  const projectId = "project-1";
  return {
    projectId,
    versionId: "version-1",
    sources: [{ id: "source-1", projectId, kind: "pdf", checksum: "sha256:1" }],
    sourceFragments: [{
      id: "fragment-1",
      projectId,
      sourceId: "source-1",
      locator: { kind: "pdf", page: 1 },
    }],
    nodes: [{
      id: "decision-1",
      projectId,
      kind: "decision",
      stableKey: "decision:worktop-material",
      currentRevisionId: "decision-1-r1",
    }],
    revisions: [{
      id: "decision-1-r1",
      nodeId: "decision-1",
      projectId,
      title: "Use natural stone",
      payload: { material: "natural_stone" },
      origin: "ai",
      claimStatus: "interpreted",
    }],
    reviews: [],
    evidenceLinks: [{
      id: "evidence-1",
      projectId,
      nodeRevisionId: "decision-1-r1",
      sourceFragmentId: "fragment-1",
    }],
    edges: [],
  };
}

function input(overrides: Partial<ReviewRevisionInput> = {}): ReviewRevisionInput {
  return {
    snapshot: reviewableSnapshot(),
    reviewId: "review-1",
    targetRevisionId: "decision-1-r1",
    expectedRevisionId: "decision-1-r1",
    decision: "confirmed",
    initiator: {
      kind: "human_action",
      actor: { actorId: "user-1", actorType: "human" },
    },
    reviewedAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("reviewRevision", () => {
  it("confirms an AI-origin revision through a separate human action without changing content origin", () => {
    const command = input();
    const before = structuredClone(command.snapshot);

    expect(reviewRevision(command)).toEqual({
      ok: true,
      value: {
        effectiveClaimStatus: "human_confirmed",
        targetRevision: command.snapshot.revisions[0],
        review: {
          id: "review-1",
          projectId: "project-1",
          targetRevisionId: "decision-1-r1",
          decision: "confirmed",
          actor: { id: "user-1", type: "human" },
          reviewedAt: "2026-07-16T00:00:00.000Z",
        },
      },
    });
    expect(command.snapshot).toEqual(before);
    expect(command.snapshot.revisions[0]?.origin).toBe("ai");
  });

  it("maps a human rejection to human_rejected", () => {
    const result = reviewRevision(input({ decision: "rejected" }));
    expect(result.ok && result.value.effectiveClaimStatus).toBe("human_rejected");
  });

  it.each([
    {
      kind: "human_action" as const,
      actor: { actorId: "model-1", actorType: "ai" as const },
    },
    {
      kind: "system_proposal" as const,
      actor: { actorId: "system-1", actorType: "system" as const },
    },
  ])("denies non-human review initiator $kind", (initiator) => {
    expect(reviewRevision(input({ initiator }))).toEqual({
      ok: false,
      issues: [expect.objectContaining({
        code: "review_actor_not_human",
        path: "/initiator/actor",
      })],
    });
  });

  it("rejects a target/expected revision mismatch", () => {
    expect(reviewRevision(input({ expectedRevisionId: "decision-1-r2" }))).toEqual({
      ok: false,
      issues: [expect.objectContaining({
        code: "review_target_mismatch",
        entityId: "decision-1-r1",
      })],
    });
  });

  it("rejects a stale target revision", () => {
    const snapshot = reviewableSnapshot();
    snapshot.revisions.push({
      ...snapshot.revisions[0]!,
      id: "decision-1-r2",
      replacesRevisionId: "decision-1-r1",
      payload: { material: "quartz" },
    });
    snapshot.nodes[0] = { ...snapshot.nodes[0]!, currentRevisionId: "decision-1-r2" };

    expect(reviewRevision(input({ snapshot }))).toEqual({
      ok: false,
      issues: [expect.objectContaining({
        code: "review_target_stale",
        entityId: "decision-1-r1",
      })],
    });
  });

  it("requires a server-supplied ISO timestamp", () => {
    expect(reviewRevision(input({ reviewedAt: "tomorrow" }))).toEqual({
      ok: false,
      issues: [expect.objectContaining({
        code: "invalid_review_timestamp",
        path: "/reviewedAt",
      })],
    });
  });

  it("does not allow human review to legitimize an unsourced AI revision", () => {
    const snapshot = reviewableSnapshot();
    snapshot.evidenceLinks = [];

    expect(reviewRevision(input({ snapshot }))).toEqual({
      ok: false,
      issues: [expect.objectContaining({
        code: "ai_claim_missing_evidence",
        entityId: "decision-1-r1",
      })],
    });
  });

  it("rejects an unknown review decision at runtime", () => {
    expect(reviewRevision(input({ decision: "approved" as "confirmed" }))).toEqual({
      ok: false,
      issues: [expect.objectContaining({
        code: "invalid_review_decision",
        path: "/decision",
      })],
    });
  });
});
