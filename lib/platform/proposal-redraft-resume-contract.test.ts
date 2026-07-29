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

describe("proposal redraft resumes the governed workflow", () => {
  const persist = sqlFunction("persist_m1_proposal_draft_steps");

  it("keeps an exact approval-state replay idempotent", () => {
    expect(persist).not.toBe("");
    expect(persist).toMatch(
      /\bv_run\.status\s*=\s*'waiting_for_human'[\s\S]*?\bv_run\.current_step\s*=\s*'approval'[\s\S]*?\bv_progress_complete[\s\S]*?\breturn\s+v_run\.id\b/i,
    );
  });

  it("resumes a changed draft from approval through an exact compare-and-swap", () => {
    expect(persist).not.toBe("");
    expect(persist).not.toMatch(
      /\bif\s+v_run\.status\s*=\s*'waiting_for_human'\s+then[\s\S]{0,240}?\braise\s+exception\s+'proposal approval state only permits an exact idempotent replay'/i,
    );
    expect(persist).toMatch(
      /\bupdate\s+public\.workflow_runs\b[\s\S]*?\bset\s+status\s*=\s*'running'\s*,\s*current_step\s*=\s*'generate_clarifying_questions'[\s\S]*?\bwhere\s+id\s*=\s*v_run\.id[\s\S]*?\bstatus\s*=\s*'waiting_for_human'[\s\S]*?\bcurrent_step\s*=\s*'approval'/i,
    );
    expect(persist).toMatch(
      /\bif\s+not\s+found\s+then[\s\S]{0,220}?\braise\s+exception\b/i,
    );
  });

  it("records fresh digest-bound attempts and returns to approval", () => {
    for (const step of [
      "generate_clarifying_questions",
      "build_scope_draft",
      "calculate_fee",
      "generate_proposal_draft",
    ]) {
      expect(persist).toMatch(new RegExp(`['"]${step}['"]`, "i"));
    }
    expect(persist).toMatch(
      /\boutput_snapshot\b[\s\S]*?\bcontent_digest\b[\s\S]*?\bv_content_digest\b/i,
    );
    expect(persist).toMatch(
      /\bupdate\s+public\.workflow_runs\b[\s\S]*?\bstatus\s*=\s*'waiting_for_human'\s*,\s*current_step\s*=\s*'approval'/i,
    );
  });

  it("accepts an exact replay after approval without invalidating the release", () => {
    expect(persist).toMatch(
      /\bw\.status\s*=\s*'running'[\s\S]{0,120}?\bw\.current_step\s*=\s*'issue_proposal'/i,
    );
    expect(persist).toMatch(
      /\bv_run\.status\s*=\s*'running'[\s\S]{0,120}?\bv_run\.current_step\s*=\s*'issue_proposal'[\s\S]{0,160}?\bv_progress_complete[\s\S]*?\bapproval_type\s*=\s*'RELEASE_AUTHORIZED'[\s\S]*?\breturn\s+v_run\.id\b/i,
    );
  });

  it("atomically invalidates a stale release when an approved draft changes", () => {
    expect(persist).toMatch(
      /\bupdate\s+public\.workflow_runs\b[\s\S]*?\bset\s+status\s*=\s*'running'\s*,\s*current_step\s*=\s*'generate_clarifying_questions'[\s\S]*?\bstatus\s*=\s*'running'[\s\S]*?\bcurrent_step\s*=\s*'issue_proposal'/i,
    );
    expect(persist).toMatch(
      /'proposal_release_invalidated_by_redraft'/i,
    );
  });
});
