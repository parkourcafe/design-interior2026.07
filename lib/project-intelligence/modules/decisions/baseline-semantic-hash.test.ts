import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BaselineSemanticContentError,
  buildBaselineSemanticContent,
  computeBaselineSemanticHash,
  type BaselineSemanticContentInput,
} from "./baseline-semantic-hash";

const ORG = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";
const PACKAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PACKAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function input(overrides: Partial<BaselineSemanticContentInput> = {}): BaselineSemanticContentInput {
  return {
    organizationId: ORG,
    projectId: PROJECT,
    graphVersionId: "graph-v1",
    previousBaselineId: null,
    packageIds: [PACKAGE_A],
    sourceRevisionIds: [],
    requirementRevisionIds: [],
    assumptionRevisionIds: [],
    decisionRevisionIds: ["decision-r1"],
    selectionRevisionIds: ["selection-r1"],
    approvalPackageIds: ["approval-1"],
    packages: [
      { id: PACKAGE_A, kind: "root", parentPackageId: null, stableKey: "root" },
    ],
    ...overrides,
  };
}

describe("baseline semantic content", () => {
  it("emits exactly the thirteen keys the RPC folds into the hash", () => {
    // Guards against silently hashing an extra field: the RPC rebuilds this
    // object from scratch, so any key we add that it does not produce (or vice
    // versa) is an unconditional BASELINE_SEMANTIC_HASH_MISMATCH.
    expect(Object.keys(buildBaselineSemanticContent(input())).sort()).toEqual([
      "approvalPackageIds",
      "assumptionRevisionIds",
      "decisionRevisionIds",
      "graphVersionId",
      "organizationId",
      "packageIds",
      "packages",
      "previousBaselineId",
      "projectId",
      "requirementRevisionIds",
      "schemaVersion",
      "selectionRevisionIds",
      "sourceRevisionIds",
    ]);
  });

  it("keeps only the four package fields the RPC hashes, dropping name and status", () => {
    const content = buildBaselineSemanticContent(input({
      packages: [{
        id: PACKAGE_A,
        kind: "root",
        parentPackageId: null,
        stableKey: "root",
        // The authenticated read envelope also carries these two.
        name: "Root package",
        status: "active",
      } as never],
    }));
    expect((content.packages as readonly Record<string, unknown>[])[0]).toEqual({
      id: PACKAGE_A,
      kind: "root",
      parentPackageId: null,
      stableKey: "root",
    });
  });

  it("orders packages by id, not by the stableKey order the read RPC returns", () => {
    // Read RPC sorts by stable_key; the hash sorts by id::text. Feeding rows in
    // stableKey order must still produce id order.
    const content = buildBaselineSemanticContent(input({
      packageIds: [PACKAGE_B, PACKAGE_A],
      packages: [
        { id: PACKAGE_B, kind: "sub", parentPackageId: PACKAGE_A, stableKey: "aaa-first-by-key" },
        { id: PACKAGE_A, kind: "root", parentPackageId: null, stableKey: "zzz-last-by-key" },
      ],
    }));
    expect((content.packages as readonly { id: string }[]).map((row) => row.id))
      .toEqual([PACKAGE_A, PACKAGE_B]);
  });

  it("sorts every id array by code point regardless of input order", () => {
    const content = buildBaselineSemanticContent(input({
      decisionRevisionIds: ["decision-r2", "decision-r1"],
      sourceRevisionIds: ["source-b", "source-a"],
    }));
    expect(content.decisionRevisionIds).toEqual(["decision-r1", "decision-r2"]);
    expect(content.sourceRevisionIds).toEqual(["source-a", "source-b"]);
  });

  it("produces a hash stable across input permutation", () => {
    const ordered = computeBaselineSemanticHash(input({
      decisionRevisionIds: ["decision-r1", "decision-r2"],
    }));
    const shuffled = computeBaselineSemanticHash(input({
      decisionRevisionIds: ["decision-r2", "decision-r1"],
    }));
    expect(shuffled).toBe(ordered);
    expect(ordered).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("matches an independently computed sha256 over the canonical JSON", () => {
    // Independent of canonicalJson: hand-built canonical string with keys in
    // code-point order, so a regression in the shared helper cannot hide here.
    const canonical = '{"approvalPackageIds":["approval-1"]'
      + ',"assumptionRevisionIds":[]'
      + ',"decisionRevisionIds":["decision-r1"]'
      + ',"graphVersionId":"graph-v1"'
      + `,"organizationId":"${ORG}"`
      + `,"packageIds":["${PACKAGE_A}"]`
      + `,"packages":[{"id":"${PACKAGE_A}","kind":"root","parentPackageId":null,"stableKey":"root"}]`
      + ',"previousBaselineId":null'
      + `,"projectId":"${PROJECT}"`
      + ',"requirementRevisionIds":[]'
      + ',"schemaVersion":"project-ceo-baseline/0.1"'
      + ',"selectionRevisionIds":["selection-r1"]'
      + ',"sourceRevisionIds":[]}';
    const expected = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
    expect(computeBaselineSemanticHash(input())).toBe(expected);
  });

  it("rejects duplicates rather than deduping them, mirroring the RPC", () => {
    // _sorted_unique_text_array raises on duplicates; silently deduping here
    // would yield a hash the RPC refuses to produce.
    expect(() => computeBaselineSemanticHash(input({
      decisionRevisionIds: ["decision-r1", "decision-r1"],
    }))).toThrow(BaselineSemanticContentError);
  });

  it.each([
    ["empty string", ""],
    ["untrimmed value", " decision-r1"],
    ["over 160 chars", "d".repeat(161)],
  ])("rejects an id that is an %s", (_label, value) => {
    expect(() => computeBaselineSemanticHash(input({ decisionRevisionIds: [value] })))
      .toThrow(BaselineSemanticContentError);
  });

  it("requires a non-empty packageIds", () => {
    expect(() => computeBaselineSemanticHash(input({ packageIds: [], packages: [] })))
      .toThrow(BaselineSemanticContentError);
  });

  it("requires an approval package only when claims are being baselined", () => {
    expect(() => computeBaselineSemanticHash(input({ approvalPackageIds: [] })))
      .toThrow(BaselineSemanticContentError);
    // A baseline carrying only sources needs no approval package.
    expect(() => computeBaselineSemanticHash(input({
      approvalPackageIds: [],
      decisionRevisionIds: [],
      selectionRevisionIds: [],
      sourceRevisionIds: ["source-a"],
    }))).not.toThrow();
  });

  it("throws when a referenced package row is missing from the read envelope", () => {
    expect(() => computeBaselineSemanticHash(input({
      packageIds: [PACKAGE_A, PACKAGE_B],
      packages: [{ id: PACKAGE_A, kind: "root", parentPackageId: null, stableKey: "root" }],
    }))).toThrow(/unknown package/);
  });
});
