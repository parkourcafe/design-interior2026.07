import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
  ),
  "utf8",
);

function sqlFunction(name: string): string {
  const start = migration.search(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
      "i",
    ),
  );
  if (start < 0) return "";
  const tail = migration.slice(start);
  const marker = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!marker?.[1] || marker.index === undefined) return "";
  const end = tail.indexOf(marker[1], marker.index + marker[0].length);
  return end < 0 ? "" : tail.slice(0, end + marker[1].length);
}

describe("proposal authorization requires current persisted draft evidence", () => {
  const authorize = sqlFunction("authorize_proposal_revision");

  it("validates and hashes the exact persisted section projection", () => {
    expect(authorize).not.toBe("");
    expect(authorize).toMatch(
      /\bjsonb_typeof\s*\(\s*v_proposal\.sections\s*\)\s*(?:<>|is\s+distinct\s+from)\s*'array'/i,
    );
    expect(authorize).toMatch(
      /\bjsonb_array_elements\s*\(\s*v_proposal\.sections\s*\)[\s\S]*?\bjsonb_typeof\b[\s\S]*?'id'[\s\S]*?'title'[\s\S]*?'body'/i,
    );
    expect(authorize).toMatch(/\bpg_column_size\s*\(\s*v_proposal\.sections\s*\)/i);
    expect(authorize).toMatch(/\bdigest\s*\([\s\S]*?'sha256'/i);
  });

  it("binds authorization to the completed proposal step and run snapshot digest", () => {
    expect(authorize).toMatch(
      /\bfrom\s+public\.workflow_step_runs\b[\s\S]*?\bworkflow_run_id\s*=\s*v_run\.id\b[\s\S]*?\bstep_key\s*=\s*'generate_proposal_draft'[\s\S]*?\bstatus\s*=\s*'completed'[\s\S]*?\bproposal_id\b[\s\S]*?\bv_proposal\.id::text[\s\S]*?\bcontent_digest\b[\s\S]*?\bv_content_digest\b/i,
    );
    expect(authorize).toMatch(
      /\bv_run\.output_snapshot\s*#>>\s*'\{proposal_draft,proposal_id\}'[\s\S]*?\bv_proposal\.id::text/i,
    );
    expect(authorize).toMatch(
      /\bv_run\.output_snapshot\s*#>>\s*'\{proposal_draft,content_digest\}'[\s\S]*?\bv_content_digest\b/i,
    );
    expect(authorize).toMatch(
      /\braise\s+exception\s+'proposal draft workflow evidence is stale'/i,
    );
  });
});
