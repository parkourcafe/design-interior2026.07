import { FILE_INTAKE_MAX_BYTES, type FileIntakeSourceRole } from "../file-intake/policy";

export const R1_UPLOAD_FORMATS = ["skp", "dwg", "glb", "dae-package", "pdf", "jpg", "jpeg", "png"] as const;
export type R1UploadFormat = (typeof R1_UPLOAD_FORMATS)[number];
export const R1_VALIDATION_PROFILES = [
  "skp-original-retention-v1", "dwg-original-retention-v1", "glb-viewable-input-v1",
  "dae-package-conversion-input-v1", "legacy-pdf-intake-v1", "legacy-image-intake-v1",
] as const;
export type R1ValidationProfile = (typeof R1_VALIDATION_PROFILES)[number];

interface FormatPolicy {
  readonly extension: "skp" | "dwg" | "glb" | "zip" | "pdf" | "jpg" | "jpeg" | "png";
  readonly sourceKind: "skp" | "dwg" | "glb" | "dae" | "pdf" | "image";
  readonly maxBytes: number;
  readonly profile: R1ValidationProfile;
  readonly purpose: "original_retention" | "viewable_input" | "conversion_input" | "legacy_intake";
}

const cadMaxBytes = 100_000_000;
const policies = {
  skp: { extension: "skp", sourceKind: "skp", maxBytes: cadMaxBytes, profile: "skp-original-retention-v1", purpose: "original_retention" },
  dwg: { extension: "dwg", sourceKind: "dwg", maxBytes: cadMaxBytes, profile: "dwg-original-retention-v1", purpose: "original_retention" },
  glb: { extension: "glb", sourceKind: "glb", maxBytes: cadMaxBytes, profile: "glb-viewable-input-v1", purpose: "viewable_input" },
  "dae-package": { extension: "zip", sourceKind: "dae", maxBytes: cadMaxBytes, profile: "dae-package-conversion-input-v1", purpose: "conversion_input" },
  pdf: { extension: "pdf", sourceKind: "pdf", maxBytes: FILE_INTAKE_MAX_BYTES.pdf, profile: "legacy-pdf-intake-v1", purpose: "legacy_intake" },
  jpg: { extension: "jpg", sourceKind: "image", maxBytes: FILE_INTAKE_MAX_BYTES.jpg, profile: "legacy-image-intake-v1", purpose: "legacy_intake" },
  jpeg: { extension: "jpeg", sourceKind: "image", maxBytes: FILE_INTAKE_MAX_BYTES.jpeg, profile: "legacy-image-intake-v1", purpose: "legacy_intake" },
  png: { extension: "png", sourceKind: "image", maxBytes: FILE_INTAKE_MAX_BYTES.png, profile: "legacy-image-intake-v1", purpose: "legacy_intake" },
} as const satisfies Readonly<Record<R1UploadFormat, FormatPolicy>>;

/** Classification only: this neither validates bytes nor attests geometry/approval. */
export function r1UploadFormatPolicy(format: R1UploadFormat): FormatPolicy & { readonly sourceRole: FileIntakeSourceRole } {
  return { ...policies[format], sourceRole: "document" };
}
