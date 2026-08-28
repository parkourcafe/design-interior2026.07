import { createHash } from "node:crypto";

export const FILE_INTAKE_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "csv", "xlsx"] as const;
export type FileIntakeExtension = (typeof FILE_INTAKE_EXTENSIONS)[number];

export const FILE_INTAKE_SOURCE_ROLES = [
  "document",
  "drawing-preview",
  "reference",
  "photo-evidence",
  "correspondence",
  "schedule",
] as const;
export type FileIntakeSourceRole = (typeof FILE_INTAKE_SOURCE_ROLES)[number];

export const FILE_INTAKE_MAX_BYTES: Readonly<Record<FileIntakeExtension, number>> = {
  pdf: 52_428_800,
  jpg: 26_214_400,
  jpeg: 26_214_400,
  png: 26_214_400,
  csv: 26_214_400,
  xlsx: 26_214_400,
};

// Multipart framing is bounded above the largest permitted file, while the
// per-extension limits below remain the source of truth for the file itself.
export const FILE_INTAKE_MAX_REQUEST_BYTES = Math.max(
  ...Object.values(FILE_INTAKE_MAX_BYTES),
) + 512 * 1024;

const MEDIA_TYPES: Readonly<Record<FileIntakeExtension, string>> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export class FileIntakePolicyError extends Error {
  constructor(
    readonly code:
      | "unsupported_extension"
      | "invalid_size"
      | "mime_mismatch"
      | "invalid_filename"
      | "invalid_source_role",
  ) {
    super(`file_intake_${code}`);
    this.name = "FileIntakePolicyError";
  }
}

function isText(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0) return false;
  for (const byte of bytes) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) return false;
  }
  return true;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

export function fileExtension(filename: string): FileIntakeExtension {
  const trimmed = filename.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > 500 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(trimmed)
  ) {
    throw new FileIntakePolicyError("invalid_filename");
  }
  const extension = trimmed.split(".").pop()?.toLowerCase() ?? "";
  if (!FILE_INTAKE_EXTENSIONS.includes(extension as FileIntakeExtension)) {
    throw new FileIntakePolicyError("unsupported_extension");
  }
  return extension as FileIntakeExtension;
}

export function sniffFileMediaType(
  bytes: Uint8Array,
  extension: FileIntakeExtension,
): string | null {
  if (extension === "pdf" && startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }
  if (
    (extension === "jpg" || extension === "jpeg") &&
    startsWith(bytes, [0xff, 0xd8, 0xff])
  ) {
    return "image/jpeg";
  }
  if (
    extension === "png" &&
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "image/png";
  }
  if (extension === "xlsx" && startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    return MEDIA_TYPES.xlsx;
  }
  if (extension === "csv" && isText(bytes)) return "text/csv";
  return null;
}

export interface ValidatedFileIntakeUpload {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly extension: FileIntakeExtension;
  readonly mediaType: string;
  readonly browserMediaType: string | null;
  readonly checksumHex: string;
  readonly sizeBytes: number;
  readonly sourceRole: FileIntakeSourceRole;
}

export function validateFileIntakeUpload(input: {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly browserMediaType: string | null;
  readonly sourceRole: string;
}): ValidatedFileIntakeUpload {
  const extension = fileExtension(input.filename);
  if (!FILE_INTAKE_SOURCE_ROLES.includes(input.sourceRole as FileIntakeSourceRole)) {
    throw new FileIntakePolicyError("invalid_source_role");
  }
  const maxBytes = FILE_INTAKE_MAX_BYTES[extension];
  if (input.bytes.byteLength <= 0 || input.bytes.byteLength > maxBytes) {
    throw new FileIntakePolicyError("invalid_size");
  }
  const mediaType = sniffFileMediaType(input.bytes, extension);
  if (mediaType === null) throw new FileIntakePolicyError("mime_mismatch");
  const browserMediaType = input.browserMediaType?.trim().toLowerCase() || null;
  if (browserMediaType !== null && browserMediaType !== mediaType) {
    throw new FileIntakePolicyError("mime_mismatch");
  }
  return {
    bytes: input.bytes,
    filename: input.filename.trim(),
    extension,
    mediaType,
    browserMediaType,
    checksumHex: createHash("sha256").update(input.bytes).digest("hex"),
    sizeBytes: input.bytes.byteLength,
    sourceRole: input.sourceRole as FileIntakeSourceRole,
  };
}

export function assertFileIntakeQuarantineKey(input: {
  readonly objectKey: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly intakeId: string;
  readonly checksumHex: string;
  readonly sourceRole: string;
  readonly extension: string;
}): void {
  const expected =
    `project-intelligence/ru/${input.organizationId}/${input.projectId}/quarantine/` +
    `${input.intakeId}/${input.checksumHex}/${input.sourceRole}.${input.extension}`;
  if (input.objectKey !== expected) throw new FileIntakePolicyError("invalid_filename");
}

export function assertFileIntakeInternalKey(input: {
  readonly objectKey: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly checksumHex: string;
  readonly sourceRole: string;
  readonly extension: string;
}): void {
  const expected =
    `project-intelligence/ru/${input.organizationId}/${input.projectId}/sources/` +
    `${input.checksumHex}/${input.sourceRole}.${input.extension}`;
  if (input.objectKey !== expected) throw new FileIntakePolicyError("invalid_filename");
}
