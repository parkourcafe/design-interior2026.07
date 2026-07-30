import { DomainContractError } from "./errors";
import { compareCodePoints, sortedCodePoints } from "./ordering";
import type {
  JsonValue,
  NodeVersionChange,
  ProjectVersionSnapshot,
  VersionNodeSnapshot,
} from "./types";

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function pointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function childPath(path: string, segment: string): string {
  return `${path}/${pointerSegment(segment)}`;
}

export function diffJsonPaths(from: JsonValue, to: JsonValue, path = ""): string[] {
  if (Object.is(from, to)) return [];

  if (Array.isArray(from) && Array.isArray(to)) {
    const paths: string[] = [];
    const length = Math.max(from.length, to.length);
    for (let index = 0; index < length; index += 1) {
      const nextPath = childPath(path, String(index));
      if (index >= from.length || index >= to.length) {
        paths.push(nextPath);
      } else {
        paths.push(...diffJsonPaths(from[index]!, to[index]!, nextPath));
      }
    }
    return paths;
  }

  if (isObject(from) && isObject(to)) {
    const keys = sortedCodePoints(new Set([...Object.keys(from), ...Object.keys(to)]));
    const paths: string[] = [];
    for (const key of keys) {
      const nextPath = childPath(path, key);
      if (!(key in from) || !(key in to)) {
        paths.push(nextPath);
      } else {
        paths.push(...diffJsonPaths(from[key]!, to[key]!, nextPath));
      }
    }
    return paths;
  }

  return [path];
}

function indexNodes(version: ProjectVersionSnapshot): Map<string, VersionNodeSnapshot> {
  const nodes = new Map<string, VersionNodeSnapshot>();
  for (const node of version.nodes) {
    if (nodes.has(node.nodeId)) {
      throw new DomainContractError({
        code: "duplicate_snapshot_node",
        entityId: node.nodeId,
        path: `/versions/${version.versionId}/nodes/${node.nodeId}`,
        message: `Version ${version.versionId} contains duplicate node ${node.nodeId}.`,
      });
    }
    nodes.set(node.nodeId, node);
  }
  return nodes;
}

export function diffProjectVersions(
  fromVersion: ProjectVersionSnapshot,
  toVersion: ProjectVersionSnapshot,
): NodeVersionChange[] {
  if (fromVersion.projectId !== toVersion.projectId) {
    throw new DomainContractError({
      code: "diff_project_mismatch",
      path: "/projectId",
      message: "Cannot diff versions from different projects.",
    });
  }

  const fromNodes = indexNodes(fromVersion);
  const toNodes = indexNodes(toVersion);
  const nodeIds = sortedCodePoints(new Set([...fromNodes.keys(), ...toNodes.keys()]));
  const changes: NodeVersionChange[] = [];

  for (const nodeId of nodeIds) {
    const fromNode = fromNodes.get(nodeId);
    const toNode = toNodes.get(nodeId);
    if (!fromNode && toNode) {
      changes.push({
        nodeId,
        changeType: "added",
        fromRevisionId: null,
        toRevisionId: toNode.revisionId,
        changedPaths: [""],
        impactRelevant: true,
      });
      continue;
    }
    if (fromNode && !toNode) {
      changes.push({
        nodeId,
        changeType: "removed",
        fromRevisionId: fromNode.revisionId,
        toRevisionId: null,
        changedPaths: [""],
        impactRelevant: true,
      });
      continue;
    }
    if (!fromNode || !toNode) continue;

    const changedPaths = diffJsonPaths(fromNode.payload, toNode.payload);
    if (fromNode.revisionId === toNode.revisionId && changedPaths.length > 0) {
      throw new DomainContractError({
        code: "revision_immutability_violation",
        entityId: nodeId,
        path: `/nodes/${nodeId}/revisionId`,
        message: `Revision ${fromNode.revisionId} has different payloads across snapshots.`,
      });
    }
    if (changedPaths.length > 0) {
      changes.push({
        nodeId,
        changeType: "changed",
        fromRevisionId: fromNode.revisionId,
        toRevisionId: toNode.revisionId,
        changedPaths,
        impactRelevant: true,
      });
    } else if (fromNode.revisionId !== toNode.revisionId) {
      changes.push({
        nodeId,
        changeType: "revision_transition",
        fromRevisionId: fromNode.revisionId,
        toRevisionId: toNode.revisionId,
        changedPaths: [],
        impactRelevant: false,
      });
    }
  }

  return changes;
}

export function changedNodeIds(changes: readonly NodeVersionChange[]): string[] {
  return [...new Set(
    changes
      .filter(({ impactRelevant }) => impactRelevant)
      .map(({ nodeId }) => nodeId),
  )].sort(compareCodePoints);
}
