import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260826059000_projectceo_published_role_projection.sql",
    import.meta.url,
  ),
  "utf8",
);
const builderChangeTargetMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260828010000_projectceo_builder_change_target_read.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("published role projection boundary", () => {
  it("keeps the historical read private behind an additive wrapper", () => {
    expect(migration).toContain(
      "rename to get_project_workspace_read_unfiltered",
    );
    expect(migration).toContain(
      "projectceo_read_api._published_role_projection",
    );
    expect(migration).toContain(
      "projectceo_read_api.get_project_workspace_read(uuid, uuid)\n  to authenticated",
    );
    expect(migration).toContain(
      "project_intelligence._request_user_id()",
    );
    expect(migration).not.toContain("auth.uid()");
    expect(migration).not.toContain(
      "revoke all on all functions in schema projectceo_read_api",
    );
    expect(migration).not.toContain("original_filename");
    expect(migration).not.toContain("storage_object_path");
  });

  it("makes client and builder output fail closed by field family", () => {
    expect(migration).toContain("if p_role = 'client_approver' then");
    expect(migration).toContain("'sources', '[]'::jsonb");
    expect(migration).toContain("'releaseRecipients', '[]'::jsonb");
    expect(migration).toContain("'priceObservation', null");
    expect(migration).toContain("when p_role = 'builder' then coalesce(p_data -> 'executionPackages', '[]'::jsonb)");
    expect(migration).toContain("'executionPackages', case");
    expect(migration).toContain("'{exactRevisionRefs,decisions}'");
    expect(migration).toContain("version ->> 'status' = 'published'");
    expect(migration).toContain("ROLE_PROJECTION_UNRESOLVED");
  });

  it("adds only a builder-scoped command hint for create_change target resolution", () => {
    expect(builderChangeTargetMigration).toContain(
      "projectceo_read_api.get_project_workspace_read_v10",
    );
    expect(builderChangeTargetMigration).toContain(
      "projectceo_read_api._builder_change_proposed_baseline",
    );
    expect(builderChangeTargetMigration).toContain("v_role <> 'builder'");
    expect(builderChangeTargetMigration).toContain(
      "'createChangeProposedBaselineId'",
    );
    expect(builderChangeTargetMigration).toContain(
      "baseline.previous_baseline_id is not null",
    );
    expect(builderChangeTargetMigration).toContain(
      "version ->> 'baselineId' = baseline.previous_baseline_id",
    );
    expect(builderChangeTargetMigration).toContain(
      "PROJECTCEO_BUILDER_CHANGE_HELPER_PUBLIC",
    );
    expect(builderChangeTargetMigration).not.toContain("auth.uid()");
    expect(builderChangeTargetMigration).not.toMatch(
      /grant execute on function projectceo_read_api\._builder_change_proposed_baseline[\s\S]+to authenticated/i,
    );
  });
});
