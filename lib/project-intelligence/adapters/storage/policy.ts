import { createHash } from "node:crypto";

export const SOURCE_ROLES = [
  "document",
  "drawing-preview",
  "reference",
  "photo-evidence",
  "correspondence",
  "schedule",
] as const;

export type SourceRole = (typeof SOURCE_ROLES)[number];

const SOURCE_POLICIES = {
  "application/pdf:pdf": 52_428_800,
  "image/jpeg:jpg": 26_214_400,
  "image/jpeg:jpeg": 26_214_400,
  "image/png:png": 26_214_400,
  "image/webp:webp": 26_214_400,
  "text/csv:csv": 26_214_400,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet:xlsx":
    26_214_400,
  "text/plain:txt": 10_485_760,
  "message/rfc822:eml": 10_485_760,
  "application/json:json": 10_485_760,
  "audio/mpeg:mp3": 104_857_600,
  "audio/mp4:m4a": 104_857_600,
  "audio/wav:wav": 104_857_600,
} as const;

const UNSUPPORTED_RAW_EXTENSIONS = new Set([
  "dwg",
  "dxf",
  "rar",
  "zip",
  "7z",
  "tar",
  "gz",
]);

export interface ValidatedSourceFile {
  readonly bytes: Uint8Array;
  readonly checksumHex: string;
  readonly extension: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly sourceRole: SourceRole;
}
export function validateSourceFile(input: {
  readonly bytes: Uint8Array;
  readonly extension: string;
  readonly mediaType: string;
  readonly sourceRole: SourceRole;
}): ValidatedSourceFile {
  const extension = input.extension.trim().toLowerCase().replace(/^\./, "");
  const mediaType = input.mediaType.trim().toLowerCase();
  if (UNSUPPORTED_RAW_EXTENSIONS.has(extension)) {
    throw new Error("project_ceo.unsupported_source");
  }
  if (!SOURCE_ROLES.includes(input.sourceRole)) {
    throw new Error("project_ceo.invalid_source_role");
  }
  const maxBytes =
    SOURCE_POLICIES[
      `${mediaType}:${extension}` as keyof typeof SOURCE_POLICIES
    ];
  if (
    maxBytes === undefined ||
    input.bytes.byteLength <= 0 ||
    input.bytes.byteLength > maxBytes
  ) {
    throw new Error("project_ceo.invalid_source_file");
  }
  return {
    bytes: input.bytes,
    checksumHex: createHash("sha256").update(input.bytes).digest("hex"),
    extension,
    mediaType,
    sizeBytes: input.bytes.byteLength,
    sourceRole: input.sourceRole,
  };
}

export function assertCanonicalObjectKey(input: {
  readonly objectKey: string;
  readonly checksumHex: string;
  readonly extension: string;
  readonly sourceRole: SourceRole;
}): void {
  const expectedSuffix = `/sources/${input.checksumHex}/${input.sourceRole}.${input.extension}`;
  const prefixPattern =
    /^project-intelligence\/ru\/[0-9a-f-]{36}\/[0-9a-f-]{36}/;
  if (
    !prefixPattern.test(input.objectKey) ||
    !input.objectKey.endsWith(expectedSuffix) ||
    input.objectKey.includes("..")
  ) {
    throw new Error("project_ceo.storage_key_contract_violation");
  }
}
