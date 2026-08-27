import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260826059000_projectceo_published_role_projection.sql",
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
      "grant execute on function\n  projectceo_read_api.get_project_workspace_read(uuid, uuid)\n  to authenticated",
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
  });
});
