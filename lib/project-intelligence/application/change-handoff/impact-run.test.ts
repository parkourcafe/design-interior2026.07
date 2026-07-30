import { describe, expect, it } from "vitest";
import type { ProjectGraphSnapshot, ProjectVersionSnapshot } from "../../index";
import {
  ChangeHandoffApplicationService,
  canonicalJson,
  createEmptyChangeHandoffState,
  semanticSha256,
  type CalculateImpactRunCommand,
} from "./index";
import {
  calculateExecution,
  changeContext,
  fixture,
  fixtureIdFactory,
  graphV2,
  versionV1,
  versionV2,
} from "./__tests__/support/fixtures";

const service = new ChangeHandoffApplicationService({ idFactory: fixtureIdFactory });

function command(
  overrides: Partial<CalculateImpactRunCommand> = {},
): CalculateImpactRunCommand {
  return {
    execution: calculateExecution,
    state: createEmptyChangeHandoffState(
      calculateExecution.organizationId,
      calculateExecution.projectId,
    ),
    expectedStateRevision: 0,
    changeContext,
    fromVersion: versionV1,
    toVersion: versionV2,
    targetGraph: graphV2,
    idempotencyKey: "calculate-impact-001",
    ...overrides,
  };
}

describe("ChangeHandoffApplicationService.calculateImpactRun", () => {
  it("derives the golden /material root and exact three deterministic impact paths", () => {
    const expected = fixture<{ impacts: Array<Record<string, unknown>> }>("expected-impacts.json");
    const result = service.calculateImpactRun(command());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.result.changes).toEqual([{
      nodeId: "decision-worktop-material",
      changeType: "changed",
      fromRevisionId: "revision-decision-worktop-material-r1",
      toRevisionId: "revision-decision-worktop-material-r2",
      changedPaths: ["/material"],
      impactRelevant: true,
    }]);
    expect(result.value.result.changedNodeIds).toEqual(["decision-worktop-material"]);
    expect(result.value.result.impacts.map((impact) => ({
      id: impact.id,
      changedNodeId: impact.changedNodeId,
      impactedNodeId: impact.impactedNodeId,
      distance: impact.distance,
      nodePath: impact.nodePath,
      edgePath: impact.edgePath,
      initialReviewStatus: impact.initialStatus,
    }))).toEqual(expected.impacts.map((impact) => ({
      id: impact.id,
      changedNodeId: impact.changedNodeId,
      impactedNodeId: impact.impactedNodeId,
      distance: impact.distance,
      nodePath: impact.nodePath,
      edgePath: impact.edgePath,
      initialReviewStatus: impact.initialReviewStatus,
    })));
    expect(result.value.result.impacts.some(
      ({ impactedNodeId }) => impactedNodeId === "risk-natural-stone-lead-time",
    )).toBe(false);
    expect(result.value.result.algorithm.propagatingRelations).toEqual([
      "depends_on",
      "derived_from",
      "satisfies",
      "specified_by",
    ]);
    const byId = <T extends { readonly id: string }>(values: readonly T[]): T[] => (
      [...values].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    );
    expect(result.value.result.targetGraphDigest).toBe(semanticSha256({
      ...graphV2,
      sources: byId(graphV2.sources),
      sourceFragments: byId(graphV2.sourceFragments),
      nodes: byId(graphV2.nodes),
      revisions: byId(graphV2.revisions),
      reviews: byId(graphV2.reviews),
      evidenceLinks: byId(graphV2.evidenceLinks),
      edges: byId(graphV2.edges),
    }));
    expect(result.value.result.targetGraphDigest).toBe(
      "sha256:b962aeb9298e6204f8ea63d0fdd8276ccccc302cc504c76aa469d999be554ae0",
    );
    expect(result.value.result.resultDigest).toBe(
      "sha256:9b8d15a43c282f677d668b3dcad87072f5058773d73b24b2ea435c44d19e5ced",
    );
    expect(result.value.result.changeContext).toEqual(changeContext);
    expect(result.value.auditIntents).toEqual([
      expect.objectContaining({
        eventName: "impact_run_created",
        actorId: calculateExecution.actorId,
        occurredAt: calculateExecution.serverTime,
      }),
    ]);
    expect(Object.isFrozen(result.value.result)).toBe(true);
    expect(Object.isFrozen(result.value.result.impacts)).toBe(true);
  });

  it("does not accept caller-supplied roots and derives them internally", () => {
    const malicious = {
      ...command(),
      changedNodeIds: ["risk-natural-stone-lead-time"],
    } as CalculateImpactRunCommand;
    const result = service.calculateImpactRun(malicious);

    expect(result.ok && result.value.result.changedNodeIds).toEqual([
      "decision-worktop-material",
    ]);
  });

  it("preserves run output and digest when unordered graph/version arrays are shuffled", () => {
    const first = service.calculateImpactRun(command());
    const shuffledGraph: ProjectGraphSnapshot = {
      ...graphV2,
      sources: [...graphV2.sources].reverse(),
      sourceFragments: [...graphV2.sourceFragments].reverse(),
      nodes: [...graphV2.nodes].reverse(),
      revisions: [...graphV2.revisions].reverse(),
      reviews: [...graphV2.reviews].reverse(),
      evidenceLinks: [...graphV2.evidenceLinks].reverse(),
      edges: [...graphV2.edges].reverse(),
    };
    const shuffledFrom = { ...versionV1, nodes: [...versionV1.nodes].reverse() };
    const shuffledTo = { ...versionV2, nodes: [...versionV2.nodes].reverse() };
    const second = service.calculateImpactRun(command({
      fromVersion: shuffledFrom,
      toVersion: shuffledTo,
      targetGraph: shuffledGraph,
    }));

    expect(first.ok && first.value.result).toEqual(second.ok && second.value.result);
    expect(first.ok && first.value.requestDigest).toBe(second.ok && second.value.requestDigest);
  });

  it("terminates cycles and returns a stable shortest path without the root itself", () => {
    const cycle = fixture<{
      projectId: string;
      nodes: Array<{ id: string; projectId: string }>;
      edges: ProjectGraphSnapshot["edges"];
      expectedOutcome: { impactedNodeIds: string[] };
    }>("invalid-cases/cycle.json");
    const rootId = "decision-cycle-root";
    const nodeKind = (nodeId: string) => nodeId.startsWith("decision")
      ? "decision" as const
      : nodeId.startsWith("deliverable") ? "deliverable" as const : "item" as const;
    const targetGraph: ProjectGraphSnapshot = {
      projectId: cycle.projectId,
      versionId: "version-cycle-v2",
      sources: [],
      sourceFragments: [],
      nodes: cycle.nodes.map(({ id, projectId }) => ({
        id,
        projectId,
        kind: nodeKind(id),
        stableKey: id,
        currentRevisionId: id === rootId ? `${id}-r2` : `${id}-r1`,
      })),
      revisions: cycle.nodes.flatMap(({ id, projectId }) => id === rootId ? [
        {
          id: `${id}-r1`, nodeId: id, projectId, title: id, payload: { value: "old" },
          origin: "human" as const, claimStatus: "interpreted" as const,
        },
        {
          id: `${id}-r2`, nodeId: id, projectId, title: id, payload: { value: "new" },
          origin: "human" as const, claimStatus: "interpreted" as const,
          replacesRevisionId: `${id}-r1`,
        },
      ] : [{
        id: `${id}-r1`, nodeId: id, projectId, title: id, payload: {},
        origin: "human" as const, claimStatus: "interpreted" as const,
      }]),
      reviews: [],
      evidenceLinks: [],
      edges: [...cycle.edges],
    };
    const fromVersion: ProjectVersionSnapshot = {
      projectId: cycle.projectId,
      versionId: "version-cycle-v1",
      nodes: cycle.nodes.map(({ id }) => ({
        nodeId: id,
        revisionId: `${id}-r1`,
        payload: (id === rootId ? { value: "old" } : {}) as ProjectVersionSnapshot["nodes"][number]["payload"],
      })),
    };
    const toVersion: ProjectVersionSnapshot = {
      projectId: cycle.projectId,
      versionId: "version-cycle-v2",
      nodes: cycle.nodes.map(({ id }) => ({
        nodeId: id,
        revisionId: id === rootId ? `${id}-r2` : `${id}-r1`,
        payload: (id === rootId ? { value: "new" } : {}) as ProjectVersionSnapshot["nodes"][number]["payload"],
      })),
    };
    const execution = { ...calculateExecution, projectId: cycle.projectId };
    const result = service.calculateImpactRun(command({
      execution,
      state: createEmptyChangeHandoffState(execution.organizationId, execution.projectId),
      changeContext: {
        projectId: cycle.projectId,
        fromVersionId: fromVersion.versionId,
        toVersionId: toVersion.versionId,
        changeSetId: "change-set-cycle",
        reasonCode: "test_cycle",
      },
      fromVersion,
      toVersion,
      targetGraph,
    }));

    expect(result.ok && result.value.result.impacts.map(({ impactedNodeId }) => impactedNodeId))
      .toEqual(cycle.expectedOutcome.impactedNodeIds);
    expect(result.ok && result.value.result.impacts.some(({ impactedNodeId }) => impactedNodeId === rootId))
      .toBe(false);
  });

  it("rejects cross-project and mismatched exact version inputs before calculation", () => {
    const crossProject = service.calculateImpactRun(command({
      fromVersion: { ...versionV1, projectId: "project-other" },
    }));
    expect(crossProject).toMatchObject({
      ok: false,
      error: { code: "PROJECT_SCOPE_VIOLATION" },
    });

    const wrongVersion = service.calculateImpactRun(command({
      toVersion: { ...versionV2, versionId: "version-wrong-v2" },
    }));
    expect(wrongVersion).toMatchObject({ ok: false, error: { code: "VERSION_STALE" } });
  });

  it("enforces server capabilities and the optimistic state token without partial mutation", () => {
    const denied = service.calculateImpactRun(command({
      execution: { ...calculateExecution, capabilities: [] },
    }));
    expect(denied).toMatchObject({ ok: false, error: { code: "ACCESS_DENIED" } });

    const input = command({ expectedStateRevision: 1 });
    const before = canonicalJson(input.state);
    const stale = service.calculateImpactRun(input);
    expect(stale).toMatchObject({
      ok: false,
      error: {
        code: "STATE_STALE",
        details: { expectedStateRevision: 1, currentStateRevision: 0 },
      },
    });
    expect(canonicalJson(input.state)).toBe(before);
  });

  it("rejects forged runtime execution enums before persistence or audit", () => {
    const forgedActorType = service.calculateImpactRun(command({
      execution: {
        ...calculateExecution,
        actorType: "forged_runtime_value" as CalculateImpactRunCommand["execution"]["actorType"],
      },
      idempotencyKey: "calculate-impact-forged-actor-type",
    }));
    expect(forgedActorType).toMatchObject({
      ok: false,
      error: {
        code: "DOMAIN_CONTRACT_VIOLATION",
        details: { reasonCode: "INVALID_APPLICATION_ACTOR_TYPE" },
      },
    });

    const forgedCapability = service.calculateImpactRun(command({
      execution: {
        ...calculateExecution,
        capabilities: [
          "calculate_change_impact",
          "forged_runtime_value",
        ] as CalculateImpactRunCommand["execution"]["capabilities"],
      },
      idempotencyKey: "calculate-impact-forged-capability",
    }));
    expect(forgedCapability).toMatchObject({
      ok: false,
      error: {
        code: "DOMAIN_CONTRACT_VIOLATION",
        details: { reasonCode: "INVALID_CHANGE_HANDOFF_CAPABILITY" },
      },
    });
  });

  it("maps frozen revision immutability violations to a controlled application error", () => {
    const fromVersion: ProjectVersionSnapshot = {
      ...versionV1,
      nodes: versionV1.nodes.map((node) => node.nodeId === "decision-worktop-material"
        ? { ...node, revisionId: "revision-decision-worktop-material-r2" }
        : node),
    };
    const result = service.calculateImpactRun(command({ fromVersion }));

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "DOMAIN_CONTRACT_VIOLATION",
        details: { domainCode: "revision_immutability_violation" },
      },
    });
  });

  it("rejects a diff with no impact-relevant change without inventing impacts", () => {
    const unchangedFrom = { ...versionV2, versionId: versionV1.versionId };
    const result = service.calculateImpactRun(command({ fromVersion: unchangedFrom }));

    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_TRANSITION", details: { reasonCode: "NO_IMPACT_RELEVANT_CHANGE" } },
    });
  });

  it("replays the same scoped key/digest and conflicts atomically on a changed digest", () => {
    const first = service.calculateImpactRun(command());
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const replay = service.calculateImpactRun(command({
      state: first.value.nextState,
      execution: {
        ...calculateExecution,
        serverTime: "2026-07-16T02:00:00.000Z",
        requestId: "request-impact-retry",
      },
    }));
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.idempotentReplay).toBe(true);
    expect(replay.value.result).toEqual(first.value.result);
    expect(replay.value.nextState).toBe(first.value.nextState);
    expect(replay.value.auditIntents).toEqual([]);

    const beforeConflict = canonicalJson(first.value.nextState);
    const changedDigestGraph = {
      ...graphV2,
      edges: graphV2.edges.filter(({ id }) => id !== "edge-risk-decision"),
    };
    const conflict = service.calculateImpactRun(command({
      state: first.value.nextState,
      targetGraph: changedDigestGraph,
    }));
    expect(conflict).toMatchObject({ ok: false, error: { code: "IDEMPOTENCY_CONFLICT" } });
    expect(canonicalJson(first.value.nextState)).toBe(beforeConflict);
  });
});
