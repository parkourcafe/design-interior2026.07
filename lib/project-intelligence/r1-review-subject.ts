export function validateR1ReviewSubject(input: { readonly assetVersionIds: readonly string[]; readonly representationDigests: readonly string[]; readonly technicalReferenceIds: readonly string[]; readonly approvalIds: readonly string[]; readonly temporaryUrl?: string; readonly selfDigest?: string }) {
  if (input.temporaryUrl !== undefined || input.selfDigest !== undefined) throw new Error("r1_review_subject_volatile_field_forbidden");
  if (!input.assetVersionIds.length || !input.representationDigests.every((value) => /^sha256:[a-f0-9]{64}$/.test(value))) throw new Error("r1_review_subject_invalid");
  return { ...input };
}
