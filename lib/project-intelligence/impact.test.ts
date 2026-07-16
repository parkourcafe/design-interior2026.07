import { describe, expect, it } from "vitest";
import type { DomainContractError } from "./errors";
import { calculateChangeImpact, relationPropagatesChange } from "./impact";
import type { ProjectGraphEdge, ProjectGraphRelation, ProjectGraphSnapshot } from "./types";

function errorCode(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return (error as DomainContractError).code;
  }
}

function graphFixture(
  nodeIds: string[],
  edges: ProjectGraphEdge[],
  versionId = "version-2",
): ProjectGraphSnapshot {
  const projectId = "project-1";
  return {
    projectId,
    versionId,
    sources: [],
    sourceFragments: [],
    evidenceLinks: [],
    reviews: [],
    nodes: nodeIds.map((id) => ({
      id,
      projectId,
      kind: id === "decision" ? "decision" : "item",
      stableKey: `node:${id}`,
      currentRevisionId: `${id}-r1`,
    })),
    revisions: nodeIds.map((id) => ({
      id: `${id}-r1`,
      nodeId: id,
      projectId,
      title: id,
      payload: { id },
      origin: "human",
      claimStatus: "interpreted",
    })),
    edges,
  };
}

function kitchenGraph(): ProjectGraphSnapshot {
  const projectId = "project-1";
  return graphFixture(
    ["decision", "item", "schedule", "budget", "risk"],
    [
      { id: "edge-item-decision", projectId, fromNodeId: "item", toNodeId: "decision", relation: "specified_by" },
      { id: "edge-schedule-item", projectId, fromNodeId: "schedule", toNodeId: "item", relation: "depends_on" },
      { id: "edge-budget-item", projectId, fromNodeId: "budget", toNodeId: "item", relation: "depends_on" },
      { id: "edge-risk-decision", projectId, fromNodeId: "risk", toNodeId: "decision", relation: "conflicts_with" },
      { id: "edge-cycle", projectId, fromNodeId: "decision", toNodeId: "schedule", relation: "depends_on" },
    ],
  );
}

describe("calculateChangeImpact", () => {
  it("returns one-hop, multi-hop and branching paths while ignoring a non-propagating edge and cycle", () => {
    const impacts = calculateChangeImpact(kitchenGraph(), ["decision"]);

    expect(impacts.map(({ impactedNodeId, distance, nodePath, edgePath }) => ({
      impactedNodeId,
      distance,
      nodePath,
      edgeIds: edgePath.map(({ edgeId }) => edgeId),
    }))).toEqual([
      {
        impactedNodeId: "item",
        distance: 1,
        nodePath: ["decision", "item"],
        edgeIds: ["edge-item-decision"],
      },
      {
        impactedNodeId: "budget",
        distance: 2,
        nodePath: ["decision", "item", "budget"],
        edgeIds: ["edge-item-decision", "edge-budget-item"],
      },
      {
        impactedNodeId: "schedule",
        distance: 2,
        nodePath: ["decision", "item", "schedule"],
        edgeIds: ["edge-item-decision", "edge-schedule-item"],
      },
    ]);
  });

  it("chooses the code-point-smallest path among equal shortest paths regardless of edge order", () => {
    const projectId = "project-1";
    const edges: ProjectGraphEdge[] = [
      { id: "edge-b-root", projectId, fromNodeId: "b", toNodeId: "root", relation: "depends_on" },
      { id: "edge-a-root", projectId, fromNodeId: "a", toNodeId: "root", relation: "depends_on" },
      { id: "edge-target-b", projectId, fromNodeId: "target", toNodeId: "b", relation: "depends_on" },
      { id: "edge-target-a", projectId, fromNodeId: "target", toNodeId: "a", relation: "depends_on" },
    ];

    const first = calculateChangeImpact(graphFixture(["root", "a", "b", "target"], edges), ["root"]);
    const second = calculateChangeImpact(graphFixture(
      ["target", "b", "a", "root"],
      [...edges].reverse(),
    ), ["root"]);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.find(({ impactedNodeId }) => impactedNodeId === "target")).toMatchObject({
      distance: 2,
      nodePath: ["root", "a", "target"],
      edgePath: [
        expect.objectContaining({ edgeId: "edge-a-root" }),
        expect.objectContaining({ edgeId: "edge-target-a" }),
      ],
    });
  });

  it.each([
    ["depends_on", true],
    ["derived_from", true],
    ["specified_by", true],
    ["satisfies", true],
    ["applies_to", false],
    ["contains", false],
    ["conflicts_with", false],
    ["references", false],
  ] satisfies Array<[ProjectGraphRelation, boolean]>)
  ("has an explicit policy for %s", (relation, expected) => {
    expect(relationPropagatesChange(relation)).toBe(expected);
  });

  it("deduplicates roots and rejects a missing changed node with a structured code", () => {
    expect(calculateChangeImpact(kitchenGraph(), ["decision", "decision"])).toHaveLength(3);
    expect(errorCode(() => calculateChangeImpact(kitchenGraph(), ["missing"]))).toBe("changed_node_missing");
  });

  it("rejects missing/cross-project edges and requires an exact version snapshot", () => {
    const missing = kitchenGraph();
    missing.edges.push({
      id: "edge-missing",
      projectId: missing.projectId,
      fromNodeId: "missing",
      toNodeId: "decision",
      relation: "depends_on",
    });
    expect(errorCode(() => calculateChangeImpact(missing, ["decision"]))).toBe("missing_edge_node");

    const crossProject = kitchenGraph();
    crossProject.nodes[1] = { ...crossProject.nodes[1]!, projectId: "project-2" };
    expect(errorCode(() => calculateChangeImpact(crossProject, ["decision"]))).toBe("project_mismatch");

    expect(errorCode(() => calculateChangeImpact({ ...kitchenGraph(), versionId: "" }, ["decision"]))).toBe("invalid_graph_version_id");
  });

  it("is byte-deterministic for shuffled non-ASCII inputs and never mutates inputs", () => {
    const projectId = "project-1";
    const privateUse = "item-\uE000";
    const supplementary = "item-😀";
    const edges: ProjectGraphEdge[] = [
      { id: "edge-😀", projectId, fromNodeId: supplementary, toNodeId: "decision", relation: "depends_on" },
      { id: "edge-\uE000", projectId, fromNodeId: privateUse, toNodeId: "decision", relation: "depends_on" },
    ];
    const graph = graphFixture([supplementary, "decision", privateUse], edges);
    const roots = ["decision", "decision"];
    const before = structuredClone({ graph, roots });
    const first = calculateChangeImpact(graph, roots);
    const shuffled = calculateChangeImpact(
      { ...graph, nodes: [...graph.nodes].reverse(), revisions: [...graph.revisions].reverse(), edges: [...graph.edges].reverse() },
      [...roots].reverse(),
    );

    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(first));
    expect(first.map(({ impactedNodeId }) => impactedNodeId)).toEqual([privateUse, supplementary]);
    expect({ graph, roots }).toEqual(before);
  });
});
