import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("ProjectCEO Product Brain static boundary", () => {
  const adapter = read(
    "lib/project-intelligence/adapters/postgres/project-brain.ts",
  );
  const schemaMigration = read(
    "supabase/migrations/20260717100000_projectceo_product_brain_persistence.sql",
  );
  const operationsMigration = read(
    "supabase/migrations/20260717101000_projectceo_product_brain_operations.sql",
  );

  it("keeps application code off private tables and caller-supplied identity", () => {
    expect(adapter).not.toContain('schema("projectceo_product")');
    expect(adapter).not.toMatch(/\.from\s*\(/);
    expect(adapter).not.toMatch(
      /\b(?:organization_id|actor_id|actor_user_id|created_at|published_at)\s*:/,
    );
    expect(adapter).toContain('schema("projectceo_product_api")');
    expect(adapter).toContain('schema("projectceo_api")');
  });

  it("materializes Selection as its own graph kind", () => {
    expect(schemaMigration).toMatch(
      /graph_nodes_kind_check[\s\S]*'decision',[\s\S]*'selection',[\s\S]*'risk'/,
    );
    expect(schemaMigration).not.toMatch(
      /kind\s*=\s*'(?:item|area)'[\s\S]{0,160}selection/i,
    );
  });

  it("keeps private persistence owner-only under forced RLS", () => {
    expect(schemaMigration).toContain(
      "alter table projectceo_product.%I force row level security",
    );
    expect(schemaMigration).toContain(
      "for all to pi_table_owner using (true) with check (true)",
    );
    expect(schemaMigration).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,160}projectceo_product\.[\\w\"]+[\s\S]{0,100}to\s+(?:anon|authenticated|service_role)/i,
    );
  });

  it("uses fixed-definer RPCs and explicit human/worker grants", () => {
    expect(operationsMigration).toContain("set search_path = ''");
    expect(operationsMigration).toContain("#variable_conflict use_variable");
    expect(operationsMigration).toContain(
      "grant execute on function\n  projectceo_product_api.append_system_decision_revision",
    );
    expect(operationsMigration).toContain(
      "projectceo_product_api.build_release_artifact",
    );
    expect(operationsMigration).toContain(
      "projectceo_product_api.review_approval_package",
    );
    expect(operationsMigration).toContain(
      "revoke all on all functions in schema projectceo_product_api",
    );
  });

  it("retains immutable and append-only persistence guards", () => {
    expect(schemaMigration).toContain("reject_append_only_mutation");
    expect(schemaMigration).toContain("'project_baselines'");
    expect(schemaMigration).toContain("'release_artifacts'");
    expect(schemaMigration).toContain("v_table || '_append_only'");
    expect(schemaMigration).toContain(
      "release_artifacts_semantic_tuple_key",
    );
    expect(schemaMigration).toContain(
      "release_acknowledgements_recipient_version_key",
    );
  });
});
