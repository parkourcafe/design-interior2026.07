import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260810020000_projectceo_m3_documentation_read.sql";
const migration = () => readFileSync(path, "utf8");

describe("M3 documentation read projection migration", () => {
  it("adds v7 over v6 without rewriting the base projection", () => {
    const sql = migration();
    expect(sql).toMatch(/\bbegin;/i);
    expect(sql).toMatch(/commit;\s*$/i);
    expect(sql).toContain("projectceo_read_api.get_project_workspace_read_v7");
    expect(sql).toContain("projectceo_read_api.get_project_workspace_read_v6(project_id, package_id)");
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function\s+projectceo_read_api\.get_project_workspace_read_v6/i);
    expect(sql).not.toMatch(/drop\s+function/i);
  });

  it("stays read-only and writes nothing", () => {
    const sql = migration();
    expect(sql).toMatch(/language plpgsql\s+stable/i);
    expect(sql).not.toMatch(/\binsert\s+into\b/i);
    expect(sql).not.toMatch(/\bupdate\s+projectceo/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    expect(sql).not.toMatch(/_complete_command|_replay_or_null/);
  });

  it("projects only the latest revision of each sheet", () => {
    const sql = migration();
    expect(sql).toMatch(/distinct on \(sheet\.sheet_id\)/i);
    expect(sql).toMatch(/order by sheet\.sheet_id, sheet\.revision_no desc/i);
  });

  it("keeps documentation on the studio side and out of the client's read", () => {
    const sql = migration();
    // Оба ключа отдаются одной и той же роли: раздельные правила разошлись бы.
    expect(sql.match(/v_role in \('owner_lead', 'architect'\)/g)).toHaveLength(2);
    expect(sql).toMatch(/m3DocumentationSheets/);
    expect(sql).toMatch(/m3DocumentationHandoffs/);
    expect(sql).not.toMatch(/client_approver/);
  });

  it("carries the handoff in the shape the documentation module consumes", () => {
    const sql = migration();
    for (const field of [
      "roomId",
      "designIntentRevisionId",
      "approvedM2CommitRevisionId",
      "selectionRevisionIds",
      "semanticHash",
    ]) {
      expect(sql).toContain(`'${field}'`);
    }
    expect(sql).toMatch(/handoff\.status = 'published'/);
  });

  it("is executable by an authenticated human only", () => {
    const sql = migration();
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = ''/);
    expect(sql).toMatch(
      /revoke all on function projectceo_read_api\.get_project_workspace_read_v7[^;]*from public, anon, authenticated, service_role/i,
    );
    expect(sql).toMatch(
      /grant execute on function projectceo_read_api\.get_project_workspace_read_v7\(uuid, uuid\)\s*\n?\s*to authenticated;/i,
    );
    expect(sql).not.toMatch(/to service_role;/i);
  });
});
