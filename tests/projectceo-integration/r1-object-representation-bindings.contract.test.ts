import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const sql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260912094000_r1_object_representation_bindings.sql"),
  "utf8",
);

describe("R1 immutable object and representation bindings", () => {
  it("keeps mappings package-scoped, versioned and private", () => {
    for (const table of [
      "project_objects",
      "project_object_revisions",
      "project_object_material_references",
      "external_representation_node_index",
      "object_representation_bindings",
      "technical_reference_versions",
      "technical_reference_events",
    ]) {
      expect(sql).toContain(`projectceo_foundation.${table}`);
      expect(sql).toContain(`'${table}'`);
    }

    expect(sql).toContain("assert_r1_object_revision_room_scope");
    expect(sql).toContain("assert_r1_object_room_scope");
    expect(sql).toContain("assert_r1_object_material_scope");
    expect(sql).toContain("assert_r1_binding_node_path");
    expect(sql).toContain("assert_r1_technical_reference_scope");
    expect(sql).toContain("assert_r1_technical_reference_event");
    expect(sql).toContain("R1_OBJECT_ROOM_SCOPE_MISMATCH");
    expect(sql).toContain("R1_BINDING_NODE_PATH_MISMATCH");
    expect(sql).toContain("R1_TECHNICAL_REFERENCE_SCOPE_MISMATCH");
    expect(sql).toContain("R1_TECHNICAL_REFERENCE_EVENT_MISSING");
    expect(sql).toContain("projectceo_m3.documentation_sheet_revisions");
    expect(sql).toContain("force row level security");
    expect(sql).toContain("reject_append_only_mutation()");
    expect(sql).toContain("technical_reference_id, technical_reference_revision_id");
    expect(sql).toContain("x_min < x_max and y_min < y_max");
    expect(sql).not.toContain("remhaos_integration.project_links");
  });
});
