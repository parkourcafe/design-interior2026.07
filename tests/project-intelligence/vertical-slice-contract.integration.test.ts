import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOMAIN_ERROR_CODES,
  calculateChangeImpact,
  changedNodeIds,
  diffProjectVersions,
  reviewRevision,
  validateProjectGraphSnapshot,
  type ChangeImpact,
  type ContentOrigin,
  type GraphNodeRevision,
  type HumanReview,
  type JsonValue,
  type ProjectGraphEdge,
  type ProjectGraphNode,
  type ProjectGraphNodeKind,
  type ProjectGraphRelation,
  type ProjectGraphSnapshot,
  type ProjectSource,
  type ProjectSourceKind,
  type ProjectVersionSnapshot,
  type RevisionClaimStatus,
  type SourceFragment,
  type SourceLocator,
} from "@/lib/project-intelligence";

const FIXTURE_ROOT = join(process.cwd(), "fixtures/project-intelligence/kitchen-worktop");

function fixture<T>(relativePath: string): T {
  return JSON.parse(readFileSync(join(FIXTURE_ROOT, relativePath), "utf8")) as T;
}

interface FixtureSourceFile {
  sources: Array<{
    id: string;
    projectId: string;
    sourceKind: ProjectSourceKind;
    checksum: string;
  }>;
}

interface FixtureFragmentFile {
  fragments: Array<{
    id: string;
    projectId: string;
    sourceId: string;
    fragmentKind: "pdf_region" | "structured_field" | "transcript_span";
    locator:
      | { page: number; bbox: [number, number, number, number] }
      | { jsonPointer: string; questionKey: string }
      | { startMs: number; endMs: number; speaker: string };
  }>;
}

interface FixtureRevision {
  id: string;
  nodeId: string;
  projectId: string;
  title: string;
  payload: JsonValue;
  contentOrigin: ContentOrigin;
  claimStatus: RevisionClaimStatus | "human_confirmed" | "human_rejected";
  unknownReason?: string | null;
  replacesRevisionId?: string | null;
}

interface FixtureGraph {
  projectId: string;
  version: {
    id: string;
    versionNo: number;
    nodeRevisions: Array<{ nodeId: string; revisionId: string }>;
  };
  nodes: Array<{
    id: string;
    projectId: string;
    kind: ProjectGraphNodeKind;
    stableKey: string;
    currentRevisionId: string;
  }>;
  revisions: FixtureRevision[];
  edges: Array<{
    id: string;
    projectId: string;
    fromNodeId: string;
    toNodeId: string;
    relation: ProjectGraphRelation;
    validFromVersionId: string;
    validToVersionId: string | null;
  }>;
  evidenceLinks: Array<{
    id: string;
    projectId: string;
    nodeRevisionId: string;
    sourceFragmentId: string;
  }>;
  reviews: Array<{
    id: string;
    projectId: string;
    action: "confirm" | "reject" | "edit";
    targetRevisionId: string;
    resultingRevisionId: string;
    actor: { actorId: string; actorType: "human"; role: string };
    occurredAt: string;
  }>;
}

interface ExpectedDiff {
  changes: Array<{
    nodeId: string;
    changeType: "added" | "removed" | "changed" | "revision_transition";
    fromRevisionId: string | null;
    toRevisionId: string | null;
    changedPaths: string[];
  }>;
}

interface ExpectedImpacts {
  impacts: Array<ChangeImpact & {
    id: string;
    initialReviewStatus: string;
    expectedHumanDisposition: string;
    review: Record<string, unknown>;
  }>;
}

interface ExpectedErrorCase {
  expectedError: { code: string; entityId: string };
}

const sourceFile = fixture<FixtureSourceFile>("sources.json");
const fragmentFile = fixture<FixtureFragmentFile>("fragments.json");
const graphV1Fixture = fixture<FixtureGraph>("graph-v1.json");
const graphV2Fixture = fixture<FixtureGraph>("graph-v2.json");

function mapLocator(fragment: FixtureFragmentFile["fragments"][number]): SourceLocator {
  if (fragment.fragmentKind === "pdf_region") {
    const locator = fragment.locator as { page: number; bbox: [number, number, number, number] };
    return { kind: "pdf", page: locator.page, bbox: locator.bbox };
  }
  if (fragment.fragmentKind === "transcript_span") {
    const locator = fragment.locator as { startMs: number; endMs: number; speaker: string };
    return {
      kind: "transcript",
      startMs: locator.startMs,
      endMs: locator.endMs,
      speaker: locator.speaker,
    };
  }

  // CG-018: the pure v0.1 domain has no questionnaire locator yet. The fixed
  // fixture field is projected to an addressable range over its synthetic text.
  return { kind: "plain_text", startCharacter: 61, endCharacter: 89 };
}

function baseClaimStatus(revision: FixtureRevision): RevisionClaimStatus {
  if (
    revision.claimStatus === "extracted"
    || revision.claimStatus === "interpreted"
    || revision.claimStatus === "unknown"
  ) {
    return revision.claimStatus;
  }
  return revision.contentOrigin === "ai" ? "extracted" : "interpreted";
}

function activeAtVersion(
  edge: FixtureGraph["edges"][number],
  graph: FixtureGraph,
): boolean {
  const ordinal = (versionId: string): number => {
    const match = /-v(\d+)$/.exec(versionId);
    if (!match) throw new Error(`Fixture version ID lacks a numeric suffix: ${versionId}`);
    return Number(match[1]);
  };
  const current = graph.version.versionNo;
  return ordinal(edge.validFromVersionId) <= current
    && (edge.validToVersionId === null || current < ordinal(edge.validToVersionId));
}

function mapReviews(graph: FixtureGraph): HumanReview[] {
  const currentRevisionIds = new Set(graph.nodes.map(({ currentRevisionId }) => currentRevisionId));
  return graph.revisions
    .filter((revision) => currentRevisionIds.has(revision.id))
    .filter(({ claimStatus }) => claimStatus === "human_confirmed" || claimStatus === "human_rejected")
    .map((revision) => {
      const applicationReview = graph.reviews.find(
        (review) => review.resultingRevisionId === revision.id || review.targetRevisionId === revision.id,
      );
      if (!applicationReview) throw new Error(`No fixture review maps to current revision ${revision.id}.`);
      return {
        id: applicationReview.id,
        projectId: graph.projectId,
        targetRevisionId: revision.id,
        decision: revision.claimStatus === "human_confirmed" ? "confirmed" : "rejected",
        actor: { id: applicationReview.actor.actorId, type: "human" },
        reviewedAt: applicationReview.occurredAt,
      };
    });
}

function mapGraph(graph: FixtureGraph): ProjectGraphSnapshot {
  const sources: ProjectSource[] = sourceFile.sources.map((source) => ({
    id: source.id,
    projectId: source.projectId,
    kind: source.sourceKind,
    checksum: source.checksum,
  }));
  const sourceFragments: SourceFragment[] = fragmentFile.fragments.map((fragment) => ({
    id: fragment.id,
    projectId: fragment.projectId,
    sourceId: fragment.sourceId,
    locator: mapLocator(fragment),
  }));
  const revisions: GraphNodeRevision[] = graph.revisions.map((revision) => ({
    id: revision.id,
    nodeId: revision.nodeId,
    projectId: revision.projectId,
    title: revision.title,
    payload: revision.payload,
    origin: revision.contentOrigin,
    claimStatus: baseClaimStatus(revision),
    ...(revision.unknownReason ? { unknownReason: revision.unknownReason } : {}),
    ...(revision.replacesRevisionId ? { replacesRevisionId: revision.replacesRevisionId } : {}),
  }));
  const edges: ProjectGraphEdge[] = graph.edges
    .filter((edge) => activeAtVersion(edge, graph))
    .map(({ id, projectId, fromNodeId, toNodeId, relation }) => ({
      id,
      projectId,
      fromNodeId,
      toNodeId,
      relation,
    }));

  return {
    projectId: graph.projectId,
    versionId: graph.version.id,
    sources,
    sourceFragments,
    nodes: graph.nodes.map((node) => ({ ...node })),
    revisions,
    reviews: mapReviews(graph),
    evidenceLinks: graph.evidenceLinks.map((link) => ({ ...link })),
    edges,
  };
}

function mapVersion(graph: FixtureGraph): ProjectVersionSnapshot {
  return {
    projectId: graph.projectId,
    versionId: graph.version.id,
    nodes: graph.version.nodeRevisions.map(({ nodeId, revisionId }) => {
      const revision = graph.revisions.find(({ id }) => id === revisionId);
      if (!revision) throw new Error(`Version ${graph.version.id} references missing revision ${revisionId}.`);
      return { nodeId, revisionId, payload: revision.payload };
    }),
  };
}

function minimalSnapshot(
  projectId: string,
  nodes: ProjectGraphNode[],
  revisions: GraphNodeRevision[],
  edges: ProjectGraphEdge[],
): ProjectGraphSnapshot {
  return {
    projectId,
    versionId: "version-integration-minimal-v1",
    sources: [],
    sourceFragments: [],
    nodes,
    revisions,
    reviews: [],
    evidenceLinks: [],
    edges,
  };
}

describe("Project Intelligence vertical-slice contract", () => {
  const graphV1 = mapGraph(graphV1Fixture);
  const graphV2 = mapGraph(graphV2Fixture);

  it("maps both application fixtures to valid frozen domain snapshots", () => {
    expect(validateProjectGraphSnapshot(graphV1)).toEqual([]);
    expect(validateProjectGraphSnapshot(graphV2)).toEqual([]);

    const aiDecision = graphV1.revisions.find(({ id }) => id === "revision-decision-worktop-material-r1");
    const decisionReview = graphV1.reviews.find(
      ({ targetRevisionId }) => targetRevisionId === "revision-decision-worktop-material-r1",
    );
    expect(aiDecision).toMatchObject({ origin: "ai", claimStatus: "extracted" });
    expect(decisionReview).toMatchObject({ decision: "confirmed", actor: { type: "human" } });
  });

  it("lets a human confirm AI-origin content without changing its origin", () => {
    const targetRevisionId = "revision-decision-worktop-material-r1";
    const unreviewed = {
      ...graphV1,
      reviews: graphV1.reviews.filter((review) => review.targetRevisionId !== targetRevisionId),
    };
    const result = reviewRevision({
      snapshot: unreviewed,
      reviewId: "review-integration-human-confirm",
      targetRevisionId,
      expectedRevisionId: targetRevisionId,
      decision: "confirmed",
      initiator: {
        kind: "human_action",
        actor: { actorId: "actor-integration-reviewer", actorType: "human" },
      },
      reviewedAt: "2026-07-16T02:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.issues[0]?.message ?? "Unexpected review failure.");
    expect(result.value.effectiveClaimStatus).toBe("human_confirmed");
    expect(result.value.targetRevision.origin).toBe("ai");
    expect(result.value.review.targetRevisionId).toBe(targetRevisionId);
  });

  it("matches the golden semantic diff and deterministic impact paths", () => {
    const expectedDiff = fixture<ExpectedDiff>("expected-diff.json");
    const expectedImpacts = fixture<ExpectedImpacts>("expected-impacts.json");
    const changes = diffProjectVersions(mapVersion(graphV1Fixture), mapVersion(graphV2Fixture));
    const pureChanges = changes.map(({ impactRelevant: _impactRelevant, ...change }) => change);

    expect(pureChanges).toEqual(expectedDiff.changes);
    expect(changes.every(({ impactRelevant }) => impactRelevant)).toBe(true);

    const roots = changedNodeIds(changes);
    const impacts = calculateChangeImpact(graphV2, roots);
    const goldenPureImpacts = expectedImpacts.impacts.map((impact) => ({
      changedNodeId: impact.changedNodeId,
      impactedNodeId: impact.impactedNodeId,
      distance: impact.distance,
      nodePath: impact.nodePath,
      edgePath: impact.edgePath,
    }));

    expect(roots).toEqual(["decision-worktop-material"]);
    expect(impacts).toEqual(goldenPureImpacts);
    expect(impacts.some(({ impactedNodeId }) => impactedNodeId === "risk-natural-stone-lead-time")).toBe(false);

    const reversed = {
      ...graphV2,
      nodes: [...graphV2.nodes].reverse(),
      edges: [...graphV2.edges].reverse(),
    };
    expect(calculateChangeImpact(reversed, [...roots].reverse())).toEqual(impacts);
  });

  it("maps pure-domain negative fixtures to stable domain codes", () => {
    const unsourcedCase = fixture<ExpectedErrorCase>("invalid-cases/unsourced-ai-claim.json");
    const unsourcedNode: ProjectGraphNode = {
      id: "decision-invalid-unsourced-ai",
      projectId: graphV1.projectId,
      kind: "decision",
      stableKey: "invalid-unsourced-ai",
      currentRevisionId: "revision-invalid-unsourced-ai-r1",
    };
    const unsourcedRevision: GraphNodeRevision = {
      id: "revision-invalid-unsourced-ai-r1",
      nodeId: unsourcedNode.id,
      projectId: graphV1.projectId,
      title: "Unsourced AI decision",
      payload: { material: "unknown" },
      origin: "ai",
      claimStatus: "extracted",
    };
    const unsourcedIssues = validateProjectGraphSnapshot({
      ...graphV1,
      nodes: [...graphV1.nodes, unsourcedNode],
      revisions: [...graphV1.revisions, unsourcedRevision],
    });
    expect(unsourcedCase.expectedError.code).toBe("AI_CLAIM_MISSING_EVIDENCE");
    expect(unsourcedIssues).toContainEqual(expect.objectContaining({
      code: "ai_claim_missing_evidence",
      entityId: unsourcedCase.expectedError.entityId,
    }));

    const unknownCase = fixture<ExpectedErrorCase & {
      revision: { id: string; nodeId: string; projectId: string; unknownReason: string };
    }>("invalid-cases/unknown-without-reason.json");
    const unknownNode: ProjectGraphNode = {
      id: unknownCase.revision.nodeId,
      projectId: unknownCase.revision.projectId,
      kind: "requirement",
      stableKey: "invalid-unknown-requirement",
      currentRevisionId: unknownCase.revision.id,
    };
    const unknownRevision: GraphNodeRevision = {
      id: unknownCase.revision.id,
      nodeId: unknownCase.revision.nodeId,
      projectId: unknownCase.revision.projectId,
      title: "Unknown requirement",
      payload: {},
      origin: "ai",
      claimStatus: "unknown",
      unknownReason: unknownCase.revision.unknownReason,
    };
    const unknownIssues = validateProjectGraphSnapshot({
      ...graphV1,
      nodes: [...graphV1.nodes, unknownNode],
      revisions: [...graphV1.revisions, unknownRevision],
    });
    expect(unknownIssues).toContainEqual(expect.objectContaining({
      code: "unknown_missing_reason",
      entityId: unknownCase.expectedError.entityId,
    }));

    const actorCase = fixture<ExpectedErrorCase>("invalid-cases/ai-human-confirmation.json");
    const targetRevisionId = actorCase.expectedError.entityId;
    const actorResult = reviewRevision({
      snapshot: {
        ...graphV1,
        reviews: graphV1.reviews.filter((review) => review.targetRevisionId !== targetRevisionId),
      },
      reviewId: "review-invalid-ai-actor",
      targetRevisionId,
      expectedRevisionId: targetRevisionId,
      decision: "confirmed",
      initiator: {
        kind: "human_action",
        actor: { actorId: "actor-extraction-worker", actorType: "ai" },
      },
      reviewedAt: "2026-07-16T02:00:00.000Z",
    });
    expect(actorResult).toMatchObject({
      ok: false,
      issues: [{ code: "review_actor_not_human", entityId: targetRevisionId }],
    });

    const staleCase = fixture<ExpectedErrorCase>("invalid-cases/stale-review.json");
    const staleResult = reviewRevision({
      snapshot: graphV2,
      reviewId: "review-invalid-stale",
      targetRevisionId: staleCase.expectedError.entityId,
      expectedRevisionId: staleCase.expectedError.entityId,
      decision: "confirmed",
      initiator: {
        kind: "human_action",
        actor: { actorId: "actor-integration-reviewer", actorType: "human" },
      },
      reviewedAt: "2026-07-16T02:00:00.000Z",
    });
    expect(staleResult).toMatchObject({
      ok: false,
      issues: [{ code: "review_target_stale", entityId: staleCase.expectedError.entityId }],
    });
  });

  it("rejects the cross-project fixture and terminates on the cycle fixture", () => {
    const crossProject = fixture<{
      projectId: string;
      nodes: Array<{ id: string; projectId: string }>;
      edge: ProjectGraphEdge;
      expectedError: { entityId: string };
    }>("invalid-cases/cross-project-edge.json");
    const crossNodes: ProjectGraphNode[] = crossProject.nodes.map((node, index) => ({
      id: node.id,
      projectId: node.projectId,
      kind: index === 0 ? "decision" : "item",
      stableKey: `cross-project-${index}`,
      currentRevisionId: `${node.id}-r1`,
    }));
    const crossRevisions: GraphNodeRevision[] = crossNodes.map((node) => ({
      id: node.currentRevisionId,
      nodeId: node.id,
      projectId: node.projectId,
      title: node.id,
      payload: {},
      origin: "human",
      claimStatus: "interpreted",
    }));
    const crossIssues = validateProjectGraphSnapshot(minimalSnapshot(
      crossProject.projectId,
      crossNodes,
      crossRevisions,
      [crossProject.edge],
    ));
    expect(crossIssues).toContainEqual(expect.objectContaining({
      code: "project_mismatch",
      entityId: crossProject.expectedError.entityId,
    }));

    const cycle = fixture<{
      projectId: string;
      changedNodeIds: string[];
      nodes: Array<{ id: string; projectId: string }>;
      edges: ProjectGraphEdge[];
      expectedOutcome: { impactedNodeIds: string[]; maximumVisitedNodeCount: number };
    }>("invalid-cases/cycle.json");
    const cycleNodes: ProjectGraphNode[] = cycle.nodes.map((node) => {
      const kind: ProjectGraphNodeKind = node.id.startsWith("decision")
        ? "decision"
        : node.id.startsWith("deliverable") ? "deliverable" : "item";
      return {
        id: node.id,
        projectId: node.projectId,
        kind,
        stableKey: node.id,
        currentRevisionId: `${node.id}-r1`,
      };
    });
    const cycleRevisions: GraphNodeRevision[] = cycleNodes.map((node) => ({
      id: node.currentRevisionId,
      nodeId: node.id,
      projectId: node.projectId,
      title: node.id,
      payload: {},
      origin: "human",
      claimStatus: "interpreted",
    }));
    const cycleImpacts = calculateChangeImpact(minimalSnapshot(
      cycle.projectId,
      cycleNodes,
      cycleRevisions,
      cycle.edges,
    ), cycle.changedNodeIds);
    expect(cycleImpacts.map(({ impactedNodeId }) => impactedNodeId)).toEqual(cycle.expectedOutcome.impactedNodeIds);
    expect(cycleImpacts.length + cycle.changedNodeIds.length).toBeLessThanOrEqual(
      cycle.expectedOutcome.maximumVisitedNodeCount,
    );
  });

  it("keeps application and persistence-only failures outside the pure domain", () => {
    const delegatedCases = [
      "invalid-cases/unavailable-fragment.json",
      "invalid-cases/missing-change-reason.json",
      "invalid-cases/idempotency-conflict.json",
    ].map((path) => fixture<ExpectedErrorCase>(path).expectedError.code);

    expect(delegatedCases).toEqual([
      "EVIDENCE_ACK_REQUIRED",
      "CHANGE_REASON_REQUIRED",
      "IDEMPOTENCY_CONFLICT",
    ]);
    for (const code of delegatedCases) {
      expect(DOMAIN_ERROR_CODES).not.toContain(code.toLowerCase());
    }
  });
});
