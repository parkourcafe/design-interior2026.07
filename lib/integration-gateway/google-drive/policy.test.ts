import { describe, expect, it } from "vitest";
import {
  assertGoogleDriveScopes,
  assertGoogleDriveImportableFile,
  assertSelectedGoogleDriveObject,
  googleDriveRevisionKey,
  isDuplicateGoogleDriveRevision,
  GOOGLE_DRIVE_FILE_SCOPE,
} from "./policy";

describe("Google Drive selected-object policy", () => {
  it("accepts only the minimal drive.file scope set", () => {
    expect(assertGoogleDriveScopes([GOOGLE_DRIVE_FILE_SCOPE, "openid"])).toEqual([
      GOOGLE_DRIVE_FILE_SCOPE,
      "openid",
    ]);
    expect(() => assertGoogleDriveScopes(["https://www.googleapis.com/auth/drive"])).toThrow(
      "scope_not_allowed",
    );
  });

  it("deduplicates exact external revisions without overwriting evidence", () => {
    const object = { opaqueKey: "opaque-drive-object", revision: "etag-1" };
    const known = new Set([googleDriveRevisionKey(object)]);
    expect(isDuplicateGoogleDriveRevision(known, object)).toBe(true);
    expect(isDuplicateGoogleDriveRevision(known, { ...object, revision: "etag-2" })).toBe(false);
  });

  it("requires an explicit file before the import pipeline", () => {
    expect(() => assertGoogleDriveImportableFile({
      opaqueKey: "opaque-drive-folder",
      kind: "folder",
      displayName: "Selected folder",
      mimeType: "application/vnd.google-apps.folder",
      sizeBytes: null,
      revision: "folder-revision",
      modifiedAt: null,
    })).toThrow("file_required");
  });

  it("rejects unknown selected-object fields instead of silently stripping them", () => {
    expect(() => assertSelectedGoogleDriveObject({
      opaqueKey: "opaque-drive-pdf",
      kind: "file",
      displayName: "plan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12,
      revision: "etag-1",
      modifiedAt: null,
      organizationId: "attacker-org",
    } as never)).toThrow();
  });
});
