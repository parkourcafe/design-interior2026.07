import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as publicApi from "./index";
import { DOMAIN_ERROR_CODES } from "./errors";
import { PROPAGATING_RELATIONS } from "./impact";
import { compareCodePoints } from "./ordering";
import {
  CLAIM_STATUSES,
  CONTENT_ORIGINS,
  PROJECT_GRAPH_NODE_KINDS,
  PROJECT_GRAPH_RELATIONS,
  SOURCE_LOCATOR_KINDS,
} from "./types";

interface ContractManifest {
  contractVersion: string;
  claimStatuses: string[];
  origins: string[];
  nodeKinds: string[];
  relations: string[];
  propagatingRelations: string[];
  locatorKinds: string[];
  errorCodes: string[];
  modelTypes: Record<string, string>;
  ordering: string;
  publicExports: string[];
  runtimeExports: string[];
}

function readManifest(): ContractManifest {
  const path = resolve(process.cwd(), "docs/product-intelligence/domain/contract-v0.1.json");
  return JSON.parse(readFileSync(path, "utf8")) as ContractManifest;
}

describe("Project Intelligence Domain v0.1 manifest", () => {
  it("matches runtime enums, policies, error codes and exports", () => {
    const manifest = readManifest();
    const runtimeExports = Object.keys(publicApi).sort(compareCodePoints);

    expect(manifest.contractVersion).toBe("0.1");
    expect(manifest.claimStatuses).toEqual(CLAIM_STATUSES);
    expect(manifest.origins).toEqual(CONTENT_ORIGINS);
    expect(manifest.nodeKinds).toEqual(PROJECT_GRAPH_NODE_KINDS);
    expect(manifest.relations).toEqual(PROJECT_GRAPH_RELATIONS);
    expect(manifest.propagatingRelations).toEqual(PROPAGATING_RELATIONS);
    expect(manifest.locatorKinds).toEqual(SOURCE_LOCATOR_KINDS);
    expect(manifest.errorCodes).toEqual(DOMAIN_ERROR_CODES);
    expect(manifest.ordering).toBe("unicode_code_point");
    expect(manifest.runtimeExports).toEqual(runtimeExports);
    expect(manifest.runtimeExports.every((name) => manifest.publicExports.includes(name))).toBe(true);
  });

  it("names distinct stable node, revision, review, source and versioned graph types", () => {
    expect(readManifest().modelTypes).toEqual({
      stableNode: "ProjectGraphNode",
      revision: "GraphNodeRevision",
      humanReview: "HumanReview",
      source: "ProjectSource",
      graphSnapshot: "ProjectGraphSnapshot",
    });
  });
});
