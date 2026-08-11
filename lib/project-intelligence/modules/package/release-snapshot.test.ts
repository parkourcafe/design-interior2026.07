import { describe, expect, it } from "vitest";

import {
  buildReleaseSemanticContent,
  buildReleaseSnapshot,
  composeRelease,
  computeReleaseSemanticHash,
  confirmReleaseSnapshot,
  ReleaseCompositionError,
  type ReleaseCompositionInput,
  type ReleaseSemanticContentInput,
} from "./release-snapshot";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "41111111-1111-4111-8111-111111111111";

const base: ReleaseCompositionInput = {
  packageId: "41111111-1111-4111-8111-111111111111",
  baselineId: "baseline-1",
  previousVersionId: null,
  baselineRefs: {
    sources: [],
    requirements: [],
    assumptions: [],
    decisions: ["decision-b", "decision-a"],
    selections: [],
  },
};

/** Хеш считается от состава, а состав — от входа: собираем аргументы один раз. */
function hashArgs(input: ReleaseCompositionInput): ReleaseSemanticContentInput {
  return { organizationId, projectId, composition: composeRelease(input) };
}

function hashInput(input: ReleaseCompositionInput) {
  return buildReleaseSemanticContent(hashArgs(input));
}

describe("composeRelease", () => {
  it("takes the whole baseline, sorted by code point", () => {
    const composition = composeRelease(base);
    expect(composition.exactRevisionRefs.decisions).toEqual(["decision-a", "decision-b"]);
    expect(composition.revisionCount).toBe(2);
  });

  it("refuses a baseline with no revisions instead of letting the RPC do it", () => {
    expect(() => composeRelease({
      ...base,
      baselineRefs: { sources: [], requirements: [], assumptions: [], decisions: [], selections: [] },
    })).toThrow(ReleaseCompositionError);
  });

  it.each([
    ["duplicate", ["decision-a", "decision-a"]],
    ["untrimmed", [" decision-a"]],
    ["empty", [""]],
    ["too long", ["d".repeat(161)]],
  ])("reproduces the RPC's rejection of a %s identifier", (_label, decisions) => {
    expect(() => composeRelease({
      ...base,
      baselineRefs: { ...base.baselineRefs, decisions },
    })).toThrow(ReleaseCompositionError);
  });
});

describe("release semantic content", () => {
  it("carries exactly the seven fields the RPC rebuilds, and no versionNo", () => {
    const content = hashInput(base);
    expect(Object.keys(content).sort()).toEqual([
      "baselineId",
      "exactRevisionRefs",
      "organizationId",
      "packageId",
      "previousVersionId",
      "projectId",
      "schemaVersion",
    ]);
    expect(content).not.toHaveProperty("versionNo");
    expect(Object.keys(content.exactRevisionRefs as object).sort()).toEqual([
      "assumptions",
      "decisions",
      "requirements",
      "selections",
      "sources",
    ]);
  });

  /**
   * Значение сверено с PostgreSQL: тот же объект, пропущенный через
   * `project_intelligence._sha256_jsonb`, даёт этот же дайджест. Без этого
   * теста зеркало могло бы разойтись с RPC незаметно — и разошлось бы только
   * на последнем шаге выпуска, в виде расхождения хешей.
   */
  it("matches the digest PostgreSQL computes for the same content", () => {
    expect(computeReleaseSemanticHash(hashArgs(base))).toBe(
      "sha256:8bd6f697380d3e55f06f3626352a64ab6288f9e8ba011af7411aa15baa2d7f3c",
    );
  });

  it("notices every field that defines the version", () => {
    const baseline = computeReleaseSemanticHash(hashArgs(base));
    const mutations: readonly ReleaseSemanticContentInput[] = [
      { ...hashArgs(base), organizationId: "21111111-1111-4111-8111-111111111111" },
      { ...hashArgs(base), projectId: "51111111-1111-4111-8111-111111111111" },
      hashArgs({ ...base, packageId: "61111111-1111-4111-8111-111111111111" }),
      hashArgs({ ...base, baselineId: "baseline-2" }),
      hashArgs({ ...base, previousVersionId: "version-1" }),
      hashArgs({ ...base, baselineRefs: { ...base.baselineRefs, decisions: ["decision-a"] } }),
      hashArgs({ ...base, baselineRefs: { ...base.baselineRefs, sources: ["source-a"] } }),
    ];
    for (const mutation of mutations) {
      expect(computeReleaseSemanticHash(mutation)).not.toBe(baseline);
    }
  });
});

describe("snapshot token", () => {
  it("does not fold in the tenant: the surface shows composition, not ownership", () => {
    expect(buildReleaseSnapshot(base).token).not.toBe(computeReleaseSemanticHash(hashArgs(base)));
  });

  it("confirms an unchanged state", () => {
    const snapshot = buildReleaseSnapshot(base);
    const confirmation = confirmReleaseSnapshot(base, snapshot.token);
    expect(confirmation.ok).toBe(true);
  });

  it("refuses when a version was published in between", () => {
    const snapshot = buildReleaseSnapshot(base);
    const confirmation = confirmReleaseSnapshot(
      { ...base, previousVersionId: "version-1" },
      snapshot.token,
    );
    expect(confirmation).toEqual({ ok: false, reason: "state_stale" });
  });

  it("refuses when a newer baseline moved the composition", () => {
    const snapshot = buildReleaseSnapshot(base);
    const confirmation = confirmReleaseSnapshot(
      { ...base, baselineId: "baseline-2" },
      snapshot.token,
    );
    expect(confirmation).toEqual({ ok: false, reason: "state_stale" });
  });
});
