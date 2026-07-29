import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const completion = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
  ),
  "utf8",
);

function sqlFunction(name: string): string {
  const start = completion.search(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
      "i",
    ),
  );
  if (start < 0) return "";
  const tail = completion.slice(start);
  const marker = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!marker?.[1] || marker.index === undefined) return "";
  const end = tail.indexOf(marker[1], marker.index + marker[0].length);
  return end < 0 ? "" : tail.slice(0, end + marker[1].length);
}

describe("proposal issuance preserves accumulated workflow evidence", () => {
  const issue = sqlFunction("issue_proposal_revision");

  it("redefines the guarded issuance command additively", () => {
    expect(issue).not.toBe("");
    expect(issue).toMatch(/\bsecurity\s+definer\b/i);
    expect(issue).toMatch(/\bw\.workflow_version\s*=\s*1\b/i);
    expect(issue).toMatch(/\bprivate\.is_studio_member\s*\(/i);
  });

  it("merges terminal proposal evidence instead of replacing the snapshot", () => {
    expect(issue).toMatch(
      /\boutput_snapshot\s*=\s*coalesce\s*\(\s*output_snapshot\s*,\s*'\{\}'::jsonb\s*\)\s*\|\|\s*(?:pg_catalog\.)?jsonb_build_object\s*\(\s*'proposal_issue'/i,
    );
    expect(issue).toMatch(
      /\bproposal_issue\b[\s\S]*?\bproposal_id\b[\s\S]*?\bv_proposal\.id\b[\s\S]*?\bproposal_revision_id\b[\s\S]*?\bv_revision\.id\b[\s\S]*?\bapproval_request_id\b[\s\S]*?\bv_approval\.id\b/i,
    );
    expect(issue).not.toMatch(
      /\boutput_snapshot\s*=\s*(?:pg_catalog\.)?jsonb_build_object\s*\(/i,
    );
  });
});
