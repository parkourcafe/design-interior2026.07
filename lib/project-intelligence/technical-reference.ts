import { validateSourceLocator } from "./locator";

export function validateTechnicalReference(input: { readonly sheetRevisionId: string; readonly assetVersionId: string; readonly previewDigest: string; readonly locator: unknown; readonly mappingMethod: "manual" | "verified_transform" }) {
  if (!input.sheetRevisionId || !input.assetVersionId || !/^sha256:[a-f0-9]{64}$/.test(input.previewDigest)) throw new Error("technical_reference_identity_invalid");
  const locator = validateSourceLocator(input.locator);
  if (!locator.ok || locator.value.kind !== "pdf") throw new Error("technical_reference_pdf_locator_invalid");
  return { ...input, locator: locator.value };
}
