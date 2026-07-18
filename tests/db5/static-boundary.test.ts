import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("ProjectCEO M4 static boundary", () => {
  const adapter = read(
    "lib/project-intelligence/adapters/postgres/execution.ts",
  );
  const persistence = read(
    "supabase/migrations/20260717102000_projectceo_m4_execution_persistence.sql",
  );
  const operations = read(
    "supabase/migrations/20260717103000_projectceo_m4_execution_operations.sql",
  );

  it("keeps application code off private tables and caller identity", () => {
    expect(adapter).not.toContain('schema("projectceo_m4")');
    expect(adapter).not.toMatch(/\.from\s*\(/);
    expect(adapter).not.toMatch(
      /\b(?:organization_id|actor_id|actor_user_id|effective_role)\s*:/,
    );
    expect(adapter).toContain('"projectceo_m4_api"');
  });

  it("keeps private M4 persistence owner-only under forced RLS", () => {
    expect(persistence).toContain(
      "alter table projectceo_m4.%I force row level security",
    );
    expect(persistence).toContain(
      "for all to pi_table_owner using (true) with check (true)",
    );
    expect(persistence).not.toMatch(
      /grant\s+(?:select|insert|update|delete|all)[\s\S]{0,160}projectceo_m4\.[\\w\"]+[\s\S]{0,100}to\s+(?:anon|authenticated|service_role)/i,
    );
  });

  it("separates human and worker database grants", () => {
    const humanGrant = operations.slice(
      operations.indexOf("grant execute on function\n  projectceo_m4_api.submit_change_request"),
      operations.indexOf("grant execute on function\n  projectceo_m4_api.calculate_change_impact"),
    );
    const workerGrant = operations.slice(
      operations.indexOf("grant execute on function\n  projectceo_m4_api.calculate_change_impact"),
    );

    expect(humanGrant).toContain("to authenticated");
    expect(humanGrant).not.toContain("calculate_change_impact");
    expect(humanGrant).not.toContain("build_construction_handover");
    expect(workerGrant).toContain("to service_role");
    expect(workerGrant).not.toContain("submit_change_request");
    expect(workerGrant).not.toContain("review_change_impact");
  });

  it("retains bounded traversal and append-only closure guards", () => {
    expect(operations).toContain("max_depth > 20");
    expect(operations).toContain("cardinality(walk.edge_path) < max_depth");
    const impactIdentity = operations.slice(
      operations.indexOf("'impactId', 'impact:'"),
      operations.indexOf("'impactedNodeId', best.current_node_id"),
    );
    expect(impactIdentity).toContain("change_request_id");
    expect(impactIdentity).toContain("v_target_graph_version_id");
    expect(impactIdentity).not.toContain("v_impact_run_id");
    expect(persistence).toContain("reject_append_only_mutation");
    expect(persistence).toContain("m4_milestone_acceptance_closure");
    expect(persistence).toContain("m4_construction_handover_closure");
    expect(persistence).toContain("m4_product_release_impact_review");
    expect(persistence).toContain("from projectceo_m4.change_request_roots root");
    expect(persistence).toContain("from projectceo_m4.impacts root_impact");
    expect(persistence).toContain("root_impact.changed_revision_id = root.to_revision_id");
    expect(persistence).toContain("reject_closed_milestone_photo_mutation");
  });
});
