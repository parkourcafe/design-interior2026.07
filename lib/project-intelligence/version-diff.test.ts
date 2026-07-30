import { describe, expect, it } from "vitest";
import { changedNodeIds, diffJsonPaths, diffProjectVersions } from "./version-diff";
import type { DomainContractError } from "./errors";
import type { ProjectVersionSnapshot } from "./types";

function errorCode(operation: () => unknown): string | undefined {
  try {
    operation();
    return undefined;
  } catch (error) {
    return (error as DomainContractError).code;
  }
}

describe("version diff", () => {
  it("reports deterministic added, removed and nested/array changes", () => {
    const fromVersion: ProjectVersionSnapshot = {
      projectId: "project-1",
      versionId: "v1",
      nodes: [
        { nodeId: "decision", revisionId: "decision-r1", payload: { material: "stone", budget: [100, 200] } },
        { nodeId: "item", revisionId: "item-r1", payload: { name: "Worktop" } },
      ],
    };
    const toVersion: ProjectVersionSnapshot = {
      projectId: "project-1",
      versionId: "v2",
      nodes: [
        { nodeId: "deliverable", revisionId: "deliverable-r1", payload: { name: "Finish schedule" } },
        { nodeId: "decision", revisionId: "decision-r2", payload: { budget: [100, 220], material: "quartz" } },
      ],
    };

    const changes = diffProjectVersions(fromVersion, toVersion);
    expect(changes).toEqual([
      {
        nodeId: "decision",
        changeType: "changed",
        fromRevisionId: "decision-r1",
        toRevisionId: "decision-r2",
        changedPaths: ["/budget/1", "/material"],
        impactRelevant: true,
      },
      {
        nodeId: "deliverable",
        changeType: "added",
        fromRevisionId: null,
        toRevisionId: "deliverable-r1",
        changedPaths: [""],
        impactRelevant: true,
      },
      {
        nodeId: "item",
        changeType: "removed",
        fromRevisionId: "item-r1",
        toRevisionId: null,
        changedPaths: [""],
        impactRelevant: true,
      },
    ]);
    expect(changedNodeIds(changes)).toEqual(["decision", "deliverable", "item"]);
  });

  it("treats key order as semantic equality and escapes stable JSON Pointer paths", () => {
    expect(diffJsonPaths({ b: 2, a: 1 }, { a: 1, b: 2 })).toEqual([]);
    expect(diffJsonPaths({ "a/b": { "c~d": 1 } }, { "a/b": { "c~d": 2 } })).toEqual(["/a~1b/c~0d"]);
  });

  it("returns an audit-only transition for a new revision with identical semantic payload", () => {
    const fromVersion: ProjectVersionSnapshot = {
      projectId: "project-1",
      versionId: "v1",
      nodes: [{ nodeId: "decision", revisionId: "decision-r1", payload: { a: 1, b: [2] } }],
    };
    const toVersion: ProjectVersionSnapshot = {
      projectId: "project-1",
      versionId: "v2",
      nodes: [{ nodeId: "decision", revisionId: "decision-r2", payload: { b: [2], a: 1 } }],
    };

    const changes = diffProjectVersions(fromVersion, toVersion);
    expect(changes).toEqual([{
      nodeId: "decision",
      changeType: "revision_transition",
      fromRevisionId: "decision-r1",
      toRevisionId: "decision-r2",
      changedPaths: [],
      impactRelevant: false,
    }]);
    expect(changedNodeIds(changes)).toEqual([]);
  });

  it("rejects project mismatch, duplicate nodes and same-revision payload mutation with exact codes", () => {
    const base: ProjectVersionSnapshot = {
      projectId: "project-1",
      versionId: "v1",
      nodes: [{ nodeId: "decision", revisionId: "r1", payload: { value: 1 } }],
    };

    expect(errorCode(() => diffProjectVersions(base, { ...base, projectId: "project-2" }))).toBe("diff_project_mismatch");
    expect(errorCode(() => diffProjectVersions(
      { ...base, nodes: [...base.nodes, ...base.nodes] },
      { ...base, versionId: "v2" },
    ))).toBe("duplicate_snapshot_node");
    expect(errorCode(() => diffProjectVersions(
      base,
      { ...base, versionId: "v2", nodes: [{ nodeId: "decision", revisionId: "r1", payload: { value: 2 } }] },
    ))).toBe("revision_immutability_violation");
  });

  it("uses explicit Unicode code-point ordering regardless of input node/key order", () => {
    const privateUse = "node-\uE000";
    const supplementary = "node-😀";
    const fromVersion: ProjectVersionSnapshot = {
      projectId: "project-1",
      versionId: "v1",
      nodes: [
        { nodeId: supplementary, revisionId: "r1-s", payload: { "😀": 1, "\uE000": 1 } },
        { nodeId: privateUse, revisionId: "r1-p", payload: 1 },
      ],
    };
    const toVersion: ProjectVersionSnapshot = {
      projectId: "project-1",
      versionId: "v2",
      nodes: [
        { nodeId: privateUse, revisionId: "r2-p", payload: 2 },
        { nodeId: supplementary, revisionId: "r2-s", payload: { "\uE000": 2, "😀": 2 } },
      ],
    };
    const before = structuredClone({ fromVersion, toVersion });
    const ordered = diffProjectVersions(fromVersion, toVersion);
    const shuffled = diffProjectVersions(
      { ...fromVersion, nodes: [...fromVersion.nodes].reverse() },
      { ...toVersion, nodes: [...toVersion.nodes].reverse() },
    );

    expect(JSON.stringify(shuffled)).toBe(JSON.stringify(ordered));
    expect(ordered.map(({ nodeId }) => nodeId)).toEqual([privateUse, supplementary]);
    expect(ordered[1]?.changedPaths).toEqual(["/\uE000", "/😀"]);
    expect({ fromVersion, toVersion }).toEqual(before);
  });
});
