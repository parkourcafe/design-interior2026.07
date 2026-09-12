export function validateR1ReleaseAttachmentManifest(input: { readonly handoffId: string; readonly handoffRevisionId: string; readonly packageId: string; readonly approvedSnapshotDigest: string; readonly assetVersionIds: readonly string[]; readonly representationDigests: readonly string[]; readonly temporaryUrl?: string }) {
  if (input.temporaryUrl !== undefined || !input.handoffId || !input.handoffRevisionId || !input.packageId || !/^sha256:[a-f0-9]{64}$/.test(input.approvedSnapshotDigest) || !input.assetVersionIds.length || !input.representationDigests.every((x) => /^sha256:[a-f0-9]{64}$/.test(x))) throw new Error("r1_release_attachment_manifest_invalid");
  return { ...input };
}
