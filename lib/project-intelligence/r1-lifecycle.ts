export type R1RetentionDecision = "hold" | "shared_reference" | "eligible_for_owner_review";
export function planR1Retention(input: { readonly hold: boolean; readonly referenceCount: number; readonly retentionUntil: string; readonly now: string }): R1RetentionDecision {
  if (!Number.isSafeInteger(input.referenceCount) || input.referenceCount < 0 || Number.isNaN(Date.parse(input.retentionUntil)) || Number.isNaN(Date.parse(input.now))) throw new Error("r1_retention_input_invalid");
  if (input.hold) return "hold";
  if (input.referenceCount > 0) return "shared_reference";
  return Date.parse(input.retentionUntil) <= Date.parse(input.now) ? "eligible_for_owner_review" : "hold";
}
