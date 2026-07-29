import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  resolve(process.cwd(), "app/dashboard/projects/[id]/proposal/page.tsx"),
  "utf8",
);
const actions = readFileSync(
  resolve(process.cwd(), "app/dashboard/projects/[id]/proposal/actions.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
  ),
  "utf8",
);

function sqlFunction(name: string): string {
  const matches = Array.from(
    migration.matchAll(
      new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
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

describe("approved proposal browser resume and redraft", () => {
  it("allows the issue step and resolves the exact approval before persistence", () => {
    expect(page).toMatch(
      /proposalWorkflow\.status\s*===\s*"running"[\s\S]{0,120}?proposalWorkflow\.current_step\s*===\s*"issue_proposal"/,
    );
    const approvalRead = page.indexOf('.from("approval_requests")');
    const persistCall = page.indexOf('.rpc(\n    "get_or_create_m1_proposal_draft"');
    expect(approvalRead).toBeGreaterThan(-1);
    expect(persistCall).toBeGreaterThan(-1);
    expect(approvalRead).toBeGreaterThan(persistCall);

    const atomicDraft = sqlFunction("get_or_create_m1_proposal_draft");
    expect(atomicDraft).toMatch(
      /\bpublic\.persist_m1_proposal_draft_steps\s*\(/i,
    );
    expect(atomicDraft).toMatch(
      /\breturn\s+pg_catalog\.jsonb_build_object\s*\(/i,
    );
  });

  it("saves edited sections and rewinds stale approval in one database transaction", () => {
    const save = sqlFunction("save_and_persist_m1_proposal_draft");
    expect(save).not.toBe("");
    expect(save).toMatch(
      /\bupdate\s+public\.proposals\b[\s\S]*?\bset\s+sections\s*=\s*p_sections/i,
    );
    expect(save).toMatch(
      /\bpublic\.persist_m1_proposal_draft_steps\s*\(/i,
    );
    expect(actions).toMatch(
      /\.rpc\s*\(\s*"save_and_persist_m1_proposal_draft"/i,
    );
    expect(actions).not.toMatch(
      /\.from\s*\(\s*"proposals"\s*\)\s*[\s\S]{0,120}?\.update\s*\(\s*\{\s*sections\s*\}/i,
    );
  });

  it("reuses issue state only when an exact approved revision still exists", () => {
    const persist = sqlFunction("persist_m1_proposal_draft_steps");
    expect(persist).toMatch(
      /\bv_run\.status\s*=\s*'running'[\s\S]{0,120}?\bv_run\.current_step\s*=\s*'issue_proposal'[\s\S]{0,160}?\bv_progress_complete[\s\S]*?\bexists\s*\([\s\S]*?\bapproval_type\s*=\s*'RELEASE_AUTHORIZED'[\s\S]*?\brevision\.sections\s*=\s*v_proposal\.sections[\s\S]*?\breturn\s+v_run\.id/i,
    );
  });
});
