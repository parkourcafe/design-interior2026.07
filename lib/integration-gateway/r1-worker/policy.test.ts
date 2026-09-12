import { describe, expect, it } from "vitest";
import { validateR1Archive } from "./policy";
describe("R1 untrusted archive policy", () => {
  it("rejects traversal, symlinks, encryption, duplicates and expansion bombs", () => {
    for (const entries of [[{ path: "../x", kind: "file" as const }], [{ path: "x", kind: "symlink" as const }], [{ path: "x", kind: "file" as const, encrypted: true }], [{ path: "x", kind: "file" as const }, { path: "x", kind: "file" as const }]]) expect(() => validateR1Archive({ compressedBytes: 1, expandedBytes: 1, entries })).toThrow();
    expect(() => validateR1Archive({ compressedBytes: 1, expandedBytes: 101, entries: [] })).toThrow("r1_archive_expansion_rejected");
  });
});
