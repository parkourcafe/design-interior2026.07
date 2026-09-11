import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationPath = "supabase/migrations/20260911150000_projectceo_publish_release_request_bound.sql";
const migration = () => readFileSync(migrationPath, "utf8");

describe("root request-bound release migration", () => {
  it("is additive, transactional, and exposes only the approved signature", () => {
    const sql = migration();
    expect(sql).toMatch(/^--[^]*\nbegin;/i);
    expect(sql).toMatch(/commit;\s*$/i);
    expect(sql).toMatch(/create function projectceo_product_api\.publish_release_request_bound\(\s*project_id uuid, expected_baseline_id text, expected_previous_version_id text,\s*expected_state_revision bigint, command_ref text, idempotency_key text/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = ''/i);
    const signature = sql.match(
      /create function projectceo_product_api\.publish_release_request_bound\(([^)]*)\)/i,
    )?.[1] ?? "";
    expect(signature).not.toMatch(/descriptor/i);
  });

  it("derives root scope and composition on the server", () => {
    const sql = migration();
    expect(sql).toMatch(/package\.kind='project_root'/i);
    expect(sql).toMatch(/_authorize_package_human\(project_id, root_package_id, 'publish_release'\)/i);
    expect(sql).toMatch(/project_baseline_refs/i);
    expect(sql).toMatch(/ROOT_PACKAGE_NOT_IN_BASELINE/i);
    expect(sql).toMatch(/ROOT_RELEASE_REFS_REQUIRED/i);
    expect(sql).toMatch(/publish_production_package_version\(project_id,descriptor,expected_state_revision,inner_key\)/i);
  });

  it("keeps execution narrowed to authenticated", () => {
    const sql = migration();
    expect(sql).toMatch(/revoke all on function projectceo_product_api\.publish_release_request_bound[^;]*from public,anon,service_role,pi_human_executor,pi_worker_executor/i);
    expect(sql).toMatch(/grant execute on function projectceo_product_api\.publish_release_request_bound[^;]*to authenticated/i);
  });
});
