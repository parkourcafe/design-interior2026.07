import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260912100000_r1_external_annotations.sql"),
  "utf8",
);

describe("R1 external annotations", () => {
  it("keeps annotation targets exact and the human command request-bound", () => {
    expect(sql).toContain("external_annotation_revisions");
    expect(sql).toContain("assert_r1_annotation_target");
    expect(sql).toContain("R1_ANNOTATION_REPRESENTATION_MISMATCH");
    expect(sql).toContain("R1_ANNOTATION_TECHNICAL_REFERENCE_MISMATCH");
    expect(sql).toContain("_authorize_package_human(p_project_id, p_package_id, 'review_selection')");
    expect(sql).toContain("v_role is distinct from 'client_approver'");
    expect(sql).toContain("create_external_annotation");
    expect(sql).toContain("revise_external_annotation");
    expect(sql).toContain("external_annotation_created");
    expect(sql).toContain("external_annotation_revised");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("reject_append_only_mutation()");
    expect(sql).not.toMatch(/grant\s+execute[^;]*service_role/i);
  });
});
