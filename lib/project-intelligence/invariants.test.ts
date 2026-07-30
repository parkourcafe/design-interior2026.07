import { describe, expect, it } from "vitest";
import { validateProjectGraphSnapshot } from "./invariants";
import type { ProjectGraphSnapshot } from "./types";

function sourcedAiSnapshot(): ProjectGraphSnapshot {
  const projectId = "project-1";
  return {
    projectId,
    versionId: "version-1",
    sources: [
      { id: "source-1", projectId, kind: "pdf", checksum: "sha256:source-1" },
    ],
    sourceFragments: [
      {
        id: "fragment-1",
        projectId,
        sourceId: "source-1",
        locator: { kind: "pdf", page: 2, bbox: [0.1, 0.2, 0.8, 0.9] },
      },
    ],
    nodes: [
      {
        id: "requirement-1",
        projectId,
        kind: "requirement",
        stableKey: "requirement:dining-table",
        currentRevisionId: "requirement-1-r1",
      },
    ],
    revisions: [
      {
        id: "requirement-1-r1",
        nodeId: "requirement-1",
        projectId,
        title: "Keep the existing dining table",
        payload: { keepExisting: true },
        origin: "ai",
        claimStatus: "extracted",
      },
    ],
    reviews: [],
    evidenceLinks: [
      {
        id: "evidence-1",
        projectId,
        nodeRevisionId: "requirement-1-r1",
        sourceFragmentId: "fragment-1",
      },
    ],
    edges: [],
  };
}

describe("validateProjectGraphSnapshot", () => {
  it("keeps stable identity, immutable revision, source and review as separate valid records", () => {
    const snapshot = sourcedAiSnapshot();
    snapshot.reviews.push({
      id: "review-1",
      projectId: snapshot.projectId,
      targetRevisionId: "requirement-1-r1",
      decision: "confirmed",
      actor: { id: "user-1", type: "human" },
      reviewedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(validateProjectGraphSnapshot(snapshot)).toEqual([]);
    expect(snapshot.nodes[0]).toEqual({
      id: "requirement-1",
      projectId: "project-1",
      kind: "requirement",
      stableKey: "requirement:dining-table",
      currentRevisionId: "requirement-1-r1",
    });
    expect(snapshot.revisions[0]?.origin).toBe("ai");
  });

  it("requires revision-specific evidence for an AI claim even after human review", () => {
    const snapshot = sourcedAiSnapshot();
    snapshot.evidenceLinks = [];
    snapshot.reviews.push({
      id: "review-1",
      projectId: snapshot.projectId,
      targetRevisionId: "requirement-1-r1",
      decision: "confirmed",
      actor: { id: "user-1", type: "human" },
      reviewedAt: "2026-07-16T00:00:00.000Z",
    });

    expect(validateProjectGraphSnapshot(snapshot)).toEqual([
      expect.objectContaining({
        code: "ai_claim_missing_evidence",
        entityId: "requirement-1-r1",
        path: "/revisions/requirement-1-r1",
      }),
    ]);
  });

  it("rejects an unsourced AI claim before review with the same revision-specific code", () => {
    const snapshot = sourcedAiSnapshot();
    snapshot.evidenceLinks = [];

    expect(validateProjectGraphSnapshot(snapshot).map((issue) => issue.code)).toEqual([
      "ai_claim_missing_evidence",
    ]);
  });

  it("rejects evidence to a missing revision and duplicate revision/evidence IDs", () => {
    const snapshot = sourcedAiSnapshot();
    snapshot.revisions.push({ ...snapshot.revisions[0]! });
    snapshot.evidenceLinks[0] = {
      ...snapshot.evidenceLinks[0]!,
      nodeRevisionId: "missing-revision",
    };
    snapshot.evidenceLinks.push({ ...snapshot.evidenceLinks[0]! });

    expect(validateProjectGraphSnapshot(snapshot).map(({ code, entityId }) => ({ code, entityId }))).toEqual([
      { code: "ai_claim_missing_evidence", entityId: "requirement-1-r1" },
      { code: "duplicate_evidence_id", entityId: "evidence-1" },
      { code: "duplicate_revision_id", entityId: "requirement-1-r1" },
      { code: "missing_evidence_revision", entityId: "evidence-1" },
    ]);
  });

  it("closes fragment ownership through a source in the same project", () => {
    const missing = sourcedAiSnapshot();
    missing.sources = [];
    expect(validateProjectGraphSnapshot(missing).map((issue) => issue.code)).toEqual([
      "missing_fragment_source",
    ]);

    const crossProject = sourcedAiSnapshot();
    crossProject.sources[0] = { ...crossProject.sources[0]!, projectId: "project-2" };
    expect(validateProjectGraphSnapshot(crossProject).map((issue) => issue.code)).toEqual([
      "project_mismatch",
      "source_project_mismatch",
    ]);
  });

  it("rejects an unknown claim without a non-empty reason", () => {
    const snapshot = sourcedAiSnapshot();
    snapshot.revisions[0] = {
      ...snapshot.revisions[0]!,
      origin: "human",
      claimStatus: "unknown",
      unknownReason: "   ",
    };
    snapshot.evidenceLinks = [];

    expect(validateProjectGraphSnapshot(snapshot)).toEqual([
      expect.objectContaining({
        code: "unknown_missing_reason",
        entityId: "requirement-1-r1",
      }),
    ]);
  });

  it("rejects missing current revisions and semantic duplicate edges with stable codes", () => {
    const snapshot = sourcedAiSnapshot();
    snapshot.nodes.push({
      id: "deliverable-1",
      projectId: snapshot.projectId,
      kind: "deliverable",
      stableKey: "deliverable:schedule",
      currentRevisionId: "missing-current",
    });
    snapshot.edges.push(
      {
        id: "edge-1",
        projectId: snapshot.projectId,
        fromNodeId: "deliverable-1",
        toNodeId: "requirement-1",
        relation: "satisfies",
      },
      {
        id: "edge-2",
        projectId: snapshot.projectId,
        fromNodeId: "deliverable-1",
        toNodeId: "requirement-1",
        relation: "satisfies",
      },
    );

    expect(validateProjectGraphSnapshot(snapshot).map(({ code, entityId }) => ({ code, entityId }))).toEqual([
      { code: "duplicate_semantic_edge", entityId: "edge-2" },
      { code: "missing_current_revision", entityId: "deliverable-1" },
    ]);
  });

  it("detects duplicate stable node and edge identities independently of semantic duplicates", () => {
    const snapshot = sourcedAiSnapshot();
    snapshot.nodes.push({
      id: "deliverable-1",
      projectId: snapshot.projectId,
      kind: "deliverable",
      stableKey: "deliverable:schedule",
      currentRevisionId: "deliverable-1-r1",
    });
    snapshot.revisions.push({
      id: "deliverable-1-r1",
      nodeId: "deliverable-1",
      projectId: snapshot.projectId,
      title: "Schedule",
      payload: {},
      origin: "human",
      claimStatus: "interpreted",
    });
    snapshot.edges.push(
      {
        id: "edge-shared",
        projectId: snapshot.projectId,
        fromNodeId: "deliverable-1",
        toNodeId: "requirement-1",
        relation: "satisfies",
      },
      {
        id: "edge-shared",
        projectId: snapshot.projectId,
        fromNodeId: "requirement-1",
        toNodeId: "deliverable-1",
        relation: "references",
      },
    );
    snapshot.nodes.push({ ...snapshot.nodes[1]!, stableKey: "deliverable:other" });

    expect(validateProjectGraphSnapshot(snapshot).map((issue) => issue.code)).toEqual([
      "duplicate_edge_id",
      "duplicate_node_id",
    ]);
  });
});
