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

function latestSqlFunction(name: string): string {
  const matches = Array.from(
    migration.matchAll(
      new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+private\\.${name}\\s*\\(`,
        "gi",
      ),
    ),
  );
  const start = matches.at(-1)?.index ?? -1;
  if (start < 0) return "";
  const tail = migration.slice(start);
  const marker = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!marker?.[1] || marker.index === undefined) return "";
  const end = tail.indexOf(marker[1], marker.index + marker[0].length);
  return end < 0 ? "" : tail.slice(0, end + marker[1].length);
}

describe("approved project decision governance", () => {
  it("digests both the value and pinned studio-standard identity", () => {
    expect(migration).toMatch(
      /\bfunction\s+private\.project_override_value_digest\s*\(\s*p_value\s+jsonb\s*,\s*p_standard_version_id\s+uuid\s*\)/i,
    );
    expect(migration).toMatch(
      /\bjsonb_build_object\s*\([\s\S]*?'standard_version_id'[\s\S]*?p_standard_version_id[\s\S]*?'value'\s*,\s*p_value/i,
    );
    expect(migration).toMatch(
      /\bnew\.value_digest\s*:=\s*private\.project_override_value_digest\s*\(\s*new\.value\s*,\s*new\.standard_version_id\s*\)/i,
    );
  });

  it("rejects pinned standards from another studio or standard key", () => {
    expect(migration).toMatch(
      /\bfunction\s+private\.project_override_standard_is_valid\s*\(\s*p_project_id\s+uuid\s*,\s*p_standard_key\s+text\s*,\s*p_standard_version_id\s+uuid\s*\)/i,
    );
    expect(migration).toMatch(
      /\bjoin\s+public\.studio_standards\s+standard[\s\S]*?\bstandard\.studio_id\s*=\s*project\.designer_id[\s\S]*?\bstandard\.standard_key\s*=\s*p_standard_key[\s\S]*?\bstandard\.id\s*=\s*p_standard_version_id\b/i,
    );
    expect(migration).toMatch(
      /\btg_op\s*=\s*'INSERT'[\s\S]*?\bproject_override_standard_is_valid\s*\(\s*new\.project_id\s*,\s*new\.standard_key\s*,\s*new\.standard_version_id\s*\)/i,
    );
    expect(migration).toMatch(
      /\bv_override\.value_digest\s+is\s+distinct\s+from\s+p_expected_value_digest[\s\S]*?\bproject_override_standard_is_valid\s*\(\s*v_override\.project_id\s*,\s*v_override\.standard_key\s*,\s*v_override\.standard_version_id\s*\)/i,
    );
  });

  it("requires a separate authenticated-human approval transition and freezes the decision", () => {
    const guard = latestSqlFunction("enforce_project_override_governance");

    expect(guard).not.toBe("");
    expect(guard).toMatch(/\btg_op\s*=\s*'INSERT'[\s\S]*?\bnew\.approved\b/i);
    expect(guard).toMatch(/\bv_actor\s+uuid\s*:=\s*auth\.uid\s*\(\s*\)/i);
    expect(guard).toMatch(/\btg_op\s*=\s*'DELETE'/i);
    expect(guard).toMatch(
      /\bold\.approved[\s\S]*?\bexists\s*\([\s\S]*?\bpublic\.projects\b[\s\S]*?\braise\s+exception\b/i,
    );
    expect(guard).toMatch(
      /\bold\.approved[\s\S]*?\bnew\s+is\s+distinct\s+from\s+old\b[\s\S]*?\braise\s+exception\b/i,
    );
    expect(guard).toMatch(
      /\bnew\.approved[\s\S]*?\bnew\.value\s+is\s+distinct\s+from\s+old\.value\b/i,
    );
    expect(guard).toMatch(
      /\bnew\.standard_version_id\s+is\s+distinct\s+from\s+old\.standard_version_id\b/i,
    );
    expect(guard).toMatch(/'project_override_approved'/i);
    expect(guard).toMatch(/\binsert\s+into\s+public\.audit_events\b/i);
    expect(guard).toMatch(/\bsecurity\s+definer\b/i);
    expect(guard).toMatch(/\bset\s+search_path\s*=\s*''/i);
  });

  it("installs the guard and exposes only the intended mutable columns", () => {
    expect(migration).toMatch(
      /\bcreate\s+trigger\s+project_overrides_governance[\s\S]*?\bbefore\s+insert\s+or\s+update\s+or\s+delete\s+on\s+public\.project_overrides[\s\S]*?\bprivate\.enforce_project_override_governance\s*\(\s*\)/i,
    );
    expect(migration).toMatch(
      /\brevoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+table\s+public\.project_overrides\s+from\s+authenticated\b/i,
    );
    expect(migration).toMatch(
      /\bgrant\s+update\s*\(\s*value\s*,\s*standard_version_id\s*\)\s+on\s+table\s+public\.project_overrides\s+to\s+authenticated\b/i,
    );
    expect(migration).toMatch(
      /\brevoke\s+all\s+on\s+function\s+private\.enforce_project_override_governance\s*\(\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\b/i,
    );
  });

  it("binds approval to the exact reviewed digest through an authenticated-only command", () => {
    const commandMatches = Array.from(
      migration.matchAll(
        /create\s+or\s+replace\s+function\s+public\.approve_project_override\s*\(/gi,
      ),
    );
    const start = commandMatches.at(-1)?.index ?? -1;
    expect(start).toBeGreaterThan(-1);
    const command = migration.slice(start);

    expect(command).toMatch(/\bp_expected_value_digest\s+text\b/i);
    expect(command).toMatch(/\bv_actor\s+uuid\s*:=\s*auth\.uid\s*\(\s*\)/i);
    expect(command).toMatch(/\bprivate\.is_studio_member\s*\(/i);
    expect(command).toMatch(/\bfor\s+update\s+of\s+project_override\s*,\s*project\b/i);
    expect(command).toMatch(
      /\bv_override\.value_digest\s+is\s+distinct\s+from\s+p_expected_value_digest\b/i,
    );
    expect(command).toMatch(
      /\bset\s+approved\s*=\s*true[\s\S]*?\bapproval_digest\s*=\s*value_digest\b/i,
    );
    expect(command).toMatch(
      /\brevoke\s+all\s+on\s+function\s+public\.approve_project_override\s*\(\s*uuid\s*,\s*text\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*,\s*service_role\b/i,
    );
    expect(command).toMatch(
      /\bgrant\s+execute\s+on\s+function\s+public\.approve_project_override\s*\(\s*uuid\s*,\s*text\s*\)\s+to\s+authenticated\b/i,
    );
  });
});
