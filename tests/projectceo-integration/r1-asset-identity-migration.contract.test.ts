import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20260912090630_r1_asset_identity_versions.sql"), "utf8");
describe("R1 immutable asset identity migration", () => {
  it("keeps every record private, append-only and pair-bound", () => {
    for (const table of ["external_assets", "external_asset_versions", "external_representation_versions", "external_representation_attestations", "external_asset_events"]) { expect(sql).toContain(`projectceo_foundation.${table}`); expect(sql).toContain(`${table}_append_only`); }
    expect(sql).toContain("assert_external_attestation_pair");
    expect(sql).toContain("R1_ATTESTATION_PAIR_MISMATCH");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("organization_members");
  });
});
