import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260810010000_projectceo_m3_documentation_persistence.sql";
const migration = () => readFileSync(path, "utf8");

describe("M3 documentation sheet persistence migration", () => {
  it("is additive, transactional and keeps the M3 data model in a private schema", () => {
    const sql = migration();
    expect(sql).toMatch(/^-- ProjectCEO RU thin M3/);
    expect(sql).toMatch(/\bbegin;/i);
    expect(sql).toMatch(/commit;\s*$/i);
    expect(sql).toContain("create schema projectceo_m3 authorization pi_table_owner");
    expect(sql).toContain("create schema projectceo_m3_api authorization pi_table_owner");
    expect(sql).not.toMatch(/drop\s+table/i);
    expect(sql).not.toMatch(/alter\s+table\s+projectceo_product\.m2_workspace_revisions/i);
  });

  it("reuses the shared command ledger instead of building a second revision mechanism", () => {
    const sql = migration();
    expect(sql).toMatch(/projectceo_product\._replay_or_null/);
    expect(sql).toMatch(/projectceo_product\._complete_command/);
    expect(sql).toMatch(/project_intelligence\.project_workflows[^]*for update/i);
    expect(sql).toContain("'register_m3_documentation_sheet'");
    expect(sql).toContain("'attach_m3_documentation_sheet_specifications'");
    expect(sql).toContain("'m3_documentation_sheet_registered'");
    expect(sql).toContain("'m3_documentation_sheet_specifications_attached'");
    // No private idempotency, audit or state-revision table of its own.
    expect(sql).not.toMatch(/create table projectceo_m3\.(command_records|audit_events)/i);
  });

  it("keeps sheet revisions append-only and denied by default", () => {
    const sql = migration();
    expect(sql).toMatch(
      /create trigger documentation_sheet_revisions_append_only[^]*reject_append_only_mutation/i,
    );
    expect(sql).toMatch(
      /create trigger documentation_sheet_numbers_append_only[^]*reject_append_only_mutation/i,
    );
    for (const table of ["documentation_sheet_revisions", "documentation_sheet_numbers"]) {
      expect(sql).toContain(`alter table projectceo_m3.${table} enable row level security`);
      expect(sql).toContain(`alter table projectceo_m3.${table} force row level security`);
      expect(sql).toMatch(
        new RegExp(
          `revoke all on table projectceo_m3\\.${table}[^;]*from public, anon, authenticated, service_role`,
          "i",
        ),
      );
    }
    expect(sql).toMatch(/documentation_sheet_revisions_lineage_shape_check/);
  });

  it("derives sheet provenance from the published M2 handoff, never from the caller", () => {
    const sql = migration();
    expect(sql).toMatch(/entity_kind\s*=\s*'m2_m3_handoff'/);
    expect(sql).toMatch(/revision\.status\s*=\s*'published'/);
    expect(sql).toMatch(/M2_HANDOFF_REQUIRED/);
    expect(sql).toMatch(/M2_HANDOFF_INCOMPLETE/);
    // The room and the signature are read out of the handoff payload.
    expect(sql).toMatch(/v_room_id\s*:=\s*v_handoff\.payload->>'roomId'/);
    expect(sql).toMatch(/chosenVariant,semanticHash/);
    expect(sql).toMatch(/\^sha256:\[0-9a-f\]\{64\}\$/);
    // register_documentation_sheet has no room or origin parameter at all.
    const register = sql.match(
      /create function projectceo_m3_api\.register_documentation_sheet\(([^]*?)\)\s*returns jsonb/i,
    )?.[1];
    expect(register).toBeDefined();
    expect(register).not.toMatch(/room_id|semantic_hash|approved_m2_commit_revision_id/i);
  });

  it("bounds a sheet to the selections the client approved and to one sheet number", () => {
    const sql = migration();
    expect(sql).toMatch(/SPECIFICATION_NOT_APPROVED/);
    expect(sql).toMatch(/DUPLICATE_SPECIFICATION/);
    expect(sql).toMatch(/SPECIFICATION_ALREADY_ATTACHED/);
    expect(sql).toMatch(/DUPLICATE_SHEET_NUMBER/);
    expect(sql).toMatch(
      /primary key \(organization_id, project_id, package_id, sheet_number\)/i,
    );
    // An empty sheet stays legal: the domain allows it and completeness reports it.
    expect(sql).toMatch(/cardinality\(specification_revision_ids\) between 0 and 2000/);
  });

  it("exposes exactly two authenticated human commands and no read surface", () => {
    const sql = migration();
    expect(sql).toMatch(/auth\.uid\s*\(\s*\)/);
    expect(sql).toMatch(/_authorize_package_human\([^)]*'prepare_client_handoff'\)/);
    expect(sql).toMatch(/owner_lead[^;]*architect/);
    expect(sql).toContain("grant usage on schema projectceo_m3_api to authenticated;");
    expect(sql.match(/create function projectceo_m3_api\./g)).toHaveLength(2);
    expect(sql).not.toMatch(/grant[^;]*to service_role/i);
    expect(sql).not.toMatch(/create function projectceo_read_api\./i);
  });
});
