import { describe, expect, it } from "vitest";
import { validateSourceLocator } from "./locator";

describe("validateSourceLocator", () => {
  it.each([
    { kind: "pdf", page: 1, bbox: [0, 0.1, 0.8, 1] },
    { kind: "transcript", startMs: 0, endMs: 2500, speaker: "client" },
    { kind: "image", coordinateSystem: "pixel", bbox: [0, 10, 640, 480] },
    { kind: "image", coordinateSystem: "normalized", bbox: [0, 0.1, 0.8, 1] },
    { kind: "spreadsheet", sheet: "FF&E", cellRange: "B17:H17" },
    { kind: "email", messageId: "message-1", paragraph: 4 },
    { kind: "plain_text", startCharacter: 0, endCharacter: 12 },
  ])("accepts a valid $kind locator", (locator) => {
    expect(validateSourceLocator(locator)).toEqual({ ok: true, value: locator });
  });

  it.each([
    [{ kind: "pdf", page: 0 }, "invalid_locator_page", "/page"],
    [{ kind: "transcript", startMs: 20, endMs: 10 }, "invalid_locator_interval", "/endMs"],
    [{ kind: "plain_text", startCharacter: -1, endCharacter: 2 }, "invalid_locator_interval", "/startCharacter"],
    [{ kind: "image", coordinateSystem: "pixel", bbox: [10, 10, 5, 20] }, "invalid_locator_bbox", "/bbox"],
    [{ kind: "pdf", page: 1, bbox: [0, 0, 1.1, 1] }, "invalid_locator_bbox", "/bbox"],
    [{ kind: "spreadsheet", sheet: " ", cellRange: "A1" }, "empty_locator_identifier", "/sheet"],
    [{ kind: "email", messageId: "", paragraph: 1 }, "empty_locator_identifier", "/messageId"],
    [{ kind: "video", startMs: 0, endMs: 1 }, "unknown_locator_kind", "/kind"],
  ])("rejects invalid locator %# with a stable code and path", (locator, code, path) => {
    expect(validateSourceLocator(locator)).toEqual({
      ok: false,
      issues: [expect.objectContaining({ code, path })],
    });
  });
});
