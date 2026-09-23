import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessExternalSourceReadiness } from "./external-source-readiness";

const checksum = `sha256:${"1".repeat(64)}`;
function fixture() {
  // Invented UNIT fixture only, never written to a real-package manifest.
  const evidence = { sourceRevisionId: "quote-r1", evidenceLinkId: "quote-e1", fragmentId: "price-cell" };
  const observedAt = "2026-09-23T00:00:00Z";
  return { sources: [{ checksum }], priceSources: [{ selectionRevisionId: "selection-r1", status: "source_bound_observation",
    sourceChecksum: checksum, ...evidence, locator: "UnitFixture!B2", valueRub: 100, originalPrice: 100, currency: "RUB", observedAt }],
  m2: { variants: [{ selections: [{ revisionId: "selection-r1", priceObservation: { amountRub: 100, observedAt, evidence } }] }] } };
}
describe("external real-source reconciliation (not runtime acceptance)", () => {
  it("cannot promote even consistent metadata to content approval or PASS", () => {
    expect(assessExternalSourceReadiness(fixture(), [checksum], [{sourceRevisionId:"quote-r1",checksum}]))
      .toEqual({status:"SOURCE_METADATA_BOUND_CONTENT_REVIEW_REQUIRED",issues:[]});
  });
  it("does not derive revision/checksum authority from matching candidate strings", () => {
    const value=fixture();
    expect(assessExternalSourceReadiness(value,[checksum], [{sourceRevisionId:"unrelated-r1",checksum}]).issues.map(i=>i.code))
      .toContain("PRICE_REVISION_UNBOUND");
    expect(assessExternalSourceReadiness(value,[checksum]).status).toBe("SOURCE_RECONCILIATION_REQUIRED");
  });
  it("requires independently measured original bytes", () => {
    expect(assessExternalSourceReadiness(fixture(), []).issues.map(i=>i.code)).toContain("SOURCE_BYTES_UNBOUND");
  });
  it("rejects an explicitly unverified observation", () => {
    const value=fixture(); value.priceSources[0]!.status="unverified_operator_observation";
    expect(assessExternalSourceReadiness(value,[checksum]).issues.map(i=>i.code)).toContain("PRICE_SOURCE_UNVERIFIED");
  });
  it("does not treat arbitrary drawing references as price provenance", () => {
    const value=fixture(); value.priceSources[0]!.fragmentId="facade-height";
    expect(assessExternalSourceReadiness(value,[checksum]).issues.map(i=>i.code)).toContain("PRICE_PROVENANCE_MISMATCH");
  });
  it("does not normalize non-RUB money without a separate mapping", () => {
    const value=fixture(); value.priceSources[0]!.currency="IDR"; value.priceSources[0]!.originalPrice=185000;
    expect(assessExternalSourceReadiness(value,[checksum]).issues.map(i=>i.code)).toContain("NON_RUB_PRICE_REQUIRES_MAPPING");
  });
  it("rejects duplicate ambiguous price bindings", () => {
    const value=fixture(); value.priceSources.push({...value.priceSources[0]!});
    expect(assessExternalSourceReadiness(value,[checksum]).issues.map(i=>i.code)).toContain("PRICE_OBSERVATION_UNBOUND");
  });
  it("classifies the historical tracked Tashkent input as requiring reconciliation even if its declared hashes were measured", () => {
    const value=JSON.parse(readFileSync("tests/fixtures/cycle7/external-package.manifest.json","utf8"));
    const result=assessExternalSourceReadiness(value,value.sources.map((s:{checksum:string})=>s.checksum));
    expect(result.status).toBe("SOURCE_RECONCILIATION_REQUIRED");
    expect(result.issues.some(i=>i.code==="PRICE_OBSERVATION_UNBOUND")).toBe(true);
  });
});
