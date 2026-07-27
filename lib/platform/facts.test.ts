import { describe, expect, it } from "vitest";
import { normalizeBriefFacts } from "./facts";

describe("brief fact adapter", () => {
  it("keeps exact provenance and classifies constraints", () => {
    const facts = normalizeBriefFacts({ budget: { range: [1, 2] }, pain: "storage" });
    expect(facts[0]).toMatchObject({ fact_type: "constraint", evidence_locator: "answers.budget", status: "extracted" });
    expect(facts[1]).toMatchObject({ fact_type: "requirement", evidence_locator: "answers.pain" });
  });
  it("never creates human_confirmed", () => {
    expect(normalizeBriefFacts({ pain: "x" }).some((fact) => fact.status === ("human_confirmed" as never))).toBe(false);
  });
});
