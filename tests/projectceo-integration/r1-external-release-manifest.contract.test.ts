import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20260912110000_r1_external_release_attachment_manifest.sql"), "utf8");

describe("R1 external release attachment manifest", () => {
  it("keeps the manifest private, immutable and bound to its release package", () => {
    expect(sql).toContain("external_release_attachment_manifests");
    expect(sql).toContain("external_release_attachment_manifest_refs");
    expect(sql).toContain("assert_r1_external_manifest_package");
    expect(sql).toContain("R1_EXTERNAL_MANIFEST_PACKAGE_MISMATCH");
    expect(sql).toContain("production_package_versions");
    expect(sql).toContain("semantic_digest bytea not null");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("reject_append_only_mutation()");
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete)[^;]*authenticated/i);
  });
});
