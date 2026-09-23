/** Source reconciliation is separate from shape-valid M2 input. This checker
 * never converts currency, approves a price or emits runtime PASS. The caller
 * supplies checksums measured from the authorized original files, not copied
 * from the candidate manifest. Metadata consistency is not content verification. */
export interface ExternalSourceIssue {
  readonly code: "SOURCE_BYTES_UNBOUND" | "PRICE_OBSERVATION_UNBOUND" | "PRICE_SOURCE_UNVERIFIED"
    | "PRICE_DOCUMENT_UNBOUND" | "PRICE_REVISION_UNBOUND" | "PRICE_PROVENANCE_MISMATCH" | "NON_RUB_PRICE_REQUIRES_MAPPING";
  readonly index: number;
}
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const rows = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(object) : [];
const text = (v: unknown): string => typeof v === "string" ? v : "";
const sha = /^sha256:[a-f0-9]{64}$/;

export function assessExternalSourceReadiness(manifest: unknown, measuredSourceChecksums: readonly string[],
  // Independently read immutable revisions in the authorized project/package;
  // never reconstruct these bindings from the candidate price/evidence JSON.
  measuredSourceRevisions: readonly { readonly sourceRevisionId: string; readonly checksum: string }[] = []): {
  readonly status: "SOURCE_RECONCILIATION_REQUIRED" | "SOURCE_METADATA_BOUND_CONTENT_REVIEW_REQUIRED";
  readonly issues: readonly ExternalSourceIssue[];
} {
  const input = object(manifest), sources = rows(input.sources), prices = rows(input.priceSources);
  const measured = new Set(measuredSourceChecksums.filter(v => sha.test(v)));
  const declared = new Set(sources.map(s => text(s.checksum)));
  const issues: ExternalSourceIssue[] = [];
  const issue = (code: ExternalSourceIssue["code"], index: number) => { issues.push({ code, index }); };
  if (!sources.length) issue("SOURCE_BYTES_UNBOUND", 0);
  sources.forEach((s, index) => { if (!sha.test(text(s.checksum)) || !measured.has(text(s.checksum))) issue("SOURCE_BYTES_UNBOUND", index); });
  const selections = rows(object(input.m2).variants).flatMap(v => rows(v.selections));
  if (!selections.length) issue("PRICE_OBSERVATION_UNBOUND", 0);
  selections.forEach((selection, index) => {
    const observed = object(selection.priceObservation), evidence = object(observed.evidence);
    const matched = prices.filter(price => typeof selection.revisionId === "string" && price.selectionRevisionId === selection.revisionId);
    if (matched.length !== 1) { issue("PRICE_OBSERVATION_UNBOUND", index); return; }
    const price = matched[0]!;
    if (price.status !== "source_bound_observation") issue("PRICE_SOURCE_UNVERIFIED", index);
    if (!sha.test(text(price.sourceChecksum)) || !declared.has(text(price.sourceChecksum))
      || !measured.has(text(price.sourceChecksum))) issue("PRICE_DOCUMENT_UNBOUND", index);
    if (!measuredSourceRevisions.some(source => source.sourceRevisionId === price.sourceRevisionId
      && source.checksum === price.sourceChecksum)) issue("PRICE_REVISION_UNBOUND", index);
    if (!["sourceRevisionId", "evidenceLinkId", "fragmentId"].every(key => text(price[key]).length > 0 && price[key] === evidence[key])
      || !text(price.locator).trim() || !Number.isSafeInteger(price.valueRub) || Number(price.valueRub) < 0
      || price.valueRub !== observed.amountRub || price.observedAt !== observed.observedAt
      || !Number.isFinite(Date.parse(text(price.observedAt)))) issue("PRICE_PROVENANCE_MISMATCH", index);
    // Non-RUB source values are not silently relabelled or converted here. An
    // explicit source/owner mapping must be designed before such input is used.
    if (price.currency !== "RUB" || price.originalPrice !== price.valueRub) issue("NON_RUB_PRICE_REQUIRES_MAPPING", index);
  });
  return { status: issues.length ? "SOURCE_RECONCILIATION_REQUIRED" : "SOURCE_METADATA_BOUND_CONTENT_REVIEW_REQUIRED", issues };
}
