import { describe, expect, it } from "vitest";
import {
  FileIntakePolicyError,
  validateFileIntakeUpload,
} from "./policy";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("file intake policy", () => {
  it("sniffs allowed signatures and calculates the server checksum", () => {
    const result = validateFileIntakeUpload({
      bytes: bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31),
      filename: "plan.pdf",
      browserMediaType: "application/pdf",
      sourceRole: "document",
    });
    expect(result.mediaType).toBe("application/pdf");
    expect(result.checksumHex).toHaveLength(64);
  });

  it.each([
    { filename: "plan.zip", bytes: bytes(0x50, 0x4b, 0x03, 0x04) },
    { filename: "plan.pdf", bytes: bytes(0x50, 0x4b, 0x03, 0x04) },
    { filename: "plan.png", bytes: bytes(0x89, 0x50, 0x4e, 0x47) },
  ])("rejects unsupported or mismatched content", ({ filename, bytes: content }) => {
    expect(() => validateFileIntakeUpload({
      bytes: content,
      filename,
      browserMediaType: null,
      sourceRole: "document",
    })).toThrow(FileIntakePolicyError);
  });

  it("rejects a browser MIME declaration that disagrees with sniffed bytes", () => {
    expect(() => validateFileIntakeUpload({
      bytes: bytes(0x25, 0x50, 0x44, 0x46, 0x2d),
      filename: "plan.pdf",
      browserMediaType: "image/png",
      sourceRole: "document",
    })).toThrow(FileIntakePolicyError);
  });
});
