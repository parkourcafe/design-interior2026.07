import { describe, expect, it } from "vitest";
import { parseGoogleDrivePickerResult, selectedGoogleDriveObject } from "./picker";

const selected = {
  opaqueKey: "drive-file-1",
  kind: "file" as const,
  displayName: "plan.pdf",
  mimeType: "application/pdf",
  sizeBytes: 9,
  revision: "revision-1",
  modifiedAt: "2026-08-27T00:00:00.000Z",
};

describe("Google Picker selected-object contract", () => {
  it("preserves explicit selected metadata and handles cancellation", () => {
    const result = parseGoogleDrivePickerResult({ kind: "selected", object: selected });
    expect(selectedGoogleDriveObject(result)).toEqual(selected);
    const cancelled = parseGoogleDrivePickerResult({ kind: "cancelled" });
    expect(selectedGoogleDriveObject(cancelled)).toBeNull();
  });

  it("rejects provider payloads with unknown fields", () => {
    expect(() => parseGoogleDrivePickerResult({
      kind: "selected",
      object: { ...selected, accessToken: "must-not-cross-boundary" },
    })).toThrow();
  });
});
