import { z } from "zod";

export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file" as const;
export const GOOGLE_DRIVE_ALLOWED_SCOPES = [
  GOOGLE_DRIVE_FILE_SCOPE,
  "openid",
  "email",
  "profile",
] as const;

export const googleDriveObjectSchema = z.object({
  opaqueKey: z.string().min(1).max(1024),
  kind: z.enum(["file", "folder"]),
  displayName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  revision: z.string().min(1).max(255),
  modifiedAt: z.string().datetime().nullable(),
}).strict();

export type GoogleDriveSelectedObject = z.infer<typeof googleDriveObjectSchema>;

export class GoogleDrivePolicyError extends Error {
  constructor(readonly code: "scope_not_allowed" | "selection_required" | "shared_drive_not_allowed" | "file_required" | "revision_mismatch" | "metadata_mismatch") {
    super(`google_drive_${code}`);
    this.name = "GoogleDrivePolicyError";
  }
}

export function assertGoogleDriveScopes(scopes: readonly string[]): readonly string[] {
  const values = [...new Set(scopes)];
  if (!values.includes(GOOGLE_DRIVE_FILE_SCOPE) || values.some((scope) => !GOOGLE_DRIVE_ALLOWED_SCOPES.includes(scope as typeof GOOGLE_DRIVE_ALLOWED_SCOPES[number]))) {
    throw new GoogleDrivePolicyError("scope_not_allowed");
  }
  return values;
}

export function assertSelectedGoogleDriveObject(
  object: GoogleDriveSelectedObject,
): GoogleDriveSelectedObject {
  if (!object.opaqueKey.trim() || !object.revision.trim()) {
    throw new GoogleDrivePolicyError("selection_required");
  }
  return googleDriveObjectSchema.parse(object);
}

export function assertGoogleDriveImportableFile(
  object: GoogleDriveSelectedObject,
): GoogleDriveSelectedObject {
  const selected = assertSelectedGoogleDriveObject(object);
  if (selected.kind !== "file") throw new GoogleDrivePolicyError("file_required");
  return selected;
}

export function googleDriveRevisionKey(object: Pick<GoogleDriveSelectedObject, "opaqueKey" | "revision">): string {
  return `${object.opaqueKey}\0${object.revision}`;
}

export function isDuplicateGoogleDriveRevision(
  existing: ReadonlySet<string>,
  object: Pick<GoogleDriveSelectedObject, "opaqueKey" | "revision">,
): boolean {
  return existing.has(googleDriveRevisionKey(object));
}
