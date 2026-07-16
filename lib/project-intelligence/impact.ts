import { DomainContractError } from "./errors";
import { validateProjectGraphSnapshot } from "./invariants";
import { compareCodePointArrays, compareCodePoints, sortedCodePoints } from "./ordering";
import type {
  ChangeImpact,
  ImpactPathStep,
  ProjectGraphEdge,
  ProjectGraphRelation,
  ProjectGraphSnapshot,
} from "./types";

export const PROPAGATING_RELATIONS = [
  "depends_on",
  "derived_from",
  "specified_by",
  "satisfies",
] as const satisfies readonly ProjectGraphRelation[];

const PROPAGATING_RELATION_SET: ReadonlySet<ProjectGraphRelation> = new Set(PROPAGATING_RELATIONS);

interface PathCandidate {
  nodeId: string;
  nodePath: string[];
  edgePath: ImpactPathStep[];
}

function asPathStep(edge: ProjectGraphEdge): ImpactPathStep {
  return {
    edgeId: edge.id,
    relation: edge.relation,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
  };
}

function edgeIds(candidate: PathCandidate): string[] {
  return candidate.edgePath.map(({ edgeId }) => edgeId);
}

function compareCandidates(left: PathCandidate, right: PathCandidate): number {
  return left.edgePath.length - right.edgePath.length
    || compareCodePointArrays(left.nodePath, right.nodePath)
    || compareCodePointArrays(edgeIds(left), edgeIds(right));
}

function compareEdges(left: ProjectGraphEdge, right: ProjectGraphEdge): number {
  return compareCodePoints(left.fromNodeId, right.fromNodeId)
    || compareCodePoints(left.toNodeId, right.toNodeId)
    || compareCodePoints(left.relation, right.relation)
    || compareCodePoints(left.id, right.id);
}

function compareImpacts(left: ChangeImpact, right: ChangeImpact): number {
  return compareCodePoints(left.changedNodeId, right.changedNodeId)
    || left.distance - right.distance
    || compareCodePoints(left.impactedNodeId, right.impactedNodeId)
    || compareCodePointArrays(left.nodePath, right.nodePath)
    || compareCodePointArrays(
      left.edgePath.map(({ edgeId }) => edgeId),
      right.edgePath.map(({ edgeId }) => edgeId),
    );
}

export function relationPropagatesChange(relation: ProjectGraphRelation): boolean {
  return PROPAGATING_RELATION_SET.has(relation);
}

export function calculateChangeImpact(
  snapshot: ProjectGraphSnapshot,
  changedNodeIds: readonly string[],
): ChangeImpact[] {
  const invariantIssue = validateProjectGraphSnapshot(snapshot)[0];
  if (invariantIssue) throw new DomainContractError(invariantIssue);

  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const uniqueRoots = sortedCodePoints(new Set(changedNodeIds));
  for (const nodeId of uniqueRoots) {
    if (!nodes.has(nodeId)) {
      throw new DomainContractError({
        code: "changed_node_missing",
        entityId: nodeId,
        path: "/changedNodeIds",
        message: `Changed node ${nodeId} does not exist in version ${snapshot.versionId}.`,
      });
    }
  }

  const incoming = new Map<string, ProjectGraphEdge[]>();
  for (const edge of snapshot.edges) {
    if (!relationPropagatesChange(edge.relation)) continue;
    const edges = incoming.get(edge.toNodeId) ?? [];
    edges.push(edge);
    incoming.set(edge.toNodeId, edges);
  }
  for (const edges of incoming.values()) edges.sort(compareEdges);

  const impacts: ChangeImpact[] = [];
  for (const changedNodeId of uniqueRoots) {
    const root: PathCandidate = {
      nodeId: changedNodeId,
      nodePath: [changedNodeId],
      edgePath: [],
    };
    const bestPath = new Map<string, PathCandidate>([[changedNodeId, root]]);
    const frontier: PathCandidate[] = [root];

    while (frontier.length > 0) {
      frontier.sort(compareCandidates);
      const current = frontier.shift()!;
      const bestCurrent = bestPath.get(current.nodeId);
      if (!bestCurrent || compareCandidates(current, bestCurrent) !== 0) continue;

      for (const edge of incoming.get(current.nodeId) ?? []) {
        const candidate: PathCandidate = {
          nodeId: edge.fromNodeId,
          nodePath: [...current.nodePath, edge.fromNodeId],
          edgePath: [...current.edgePath, asPathStep(edge)],
        };
        const existing = bestPath.get(candidate.nodeId);
        if (!existing || compareCandidates(candidate, existing) < 0) {
          bestPath.set(candidate.nodeId, candidate);
          frontier.push(candidate);
        }
      }
    }

    for (const [impactedNodeId, path] of bestPath) {
      if (impactedNodeId === changedNodeId) continue;
      impacts.push({
        changedNodeId,
        impactedNodeId,
        distance: path.edgePath.length,
        nodePath: [...path.nodePath],
        edgePath: path.edgePath.map((step) => ({ ...step })),
      });
    }
  }

  return impacts.sort(compareImpacts);
}
