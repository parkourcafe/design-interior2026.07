export function validateR1ObjectBinding(input: { readonly objectRevisionId: string; readonly representationDigest: string; readonly nodeKey: string; readonly transform: Record<string, unknown>; readonly mappingMethod: "manual" | "stable_exporter_id" | "verified_transform"; readonly evidenceId: string }) {
  if (!input.objectRevisionId || !input.nodeKey || !input.evidenceId || !/^sha256:[a-f0-9]{64}$/.test(input.representationDigest) || !Object.keys(input.transform).length) throw new Error("r1_object_binding_invalid");
  return { ...input };
}
