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

describe("proposal authorization persists the approval workflow step", () => {
  const authorize = sqlFunction("authorize_proposal_revision");

  it("records one completed approval attempt with the exact release binding", () => {
    expect(authorize).not.toBe("");
    expect(authorize).toMatch(
      /\bfrom\s+public\.workflow_step_runs\b[\s\S]*?\bstep_key\s*=\s*'approval'[\s\S]*?\bapproval_request_id\b[\s\S]*?\bv_approval_id\b[\s\S]*?\bproposal_revision_id\b[\s\S]*?\bv_revision_id\b/i,
    );
    expect(authorize).toMatch(
      /\binsert\s+into\s+public\.workflow_step_runs\b[\s\S]*?\bworkflow_run_id\b[\s\S]*?\bstep_key\b[\s\S]*?\battempt\b[\s\S]*?\bstatus\b[\s\S]*?'approval'[\s\S]*?'completed'/i,
    );
    expect(authorize).toMatch(
      /\boutput_snapshot\b[\s\S]*?\bapproval_request_id\b[\s\S]*?\bv_approval_id\b[\s\S]*?\bproposal_revision_id\b[\s\S]*?\bv_revision_id\b/i,
    );
  });

  it("uses a new attempt only when the exact approval step is absent", () => {
    expect(authorize).toMatch(
      /\bwhere\s+not\s+exists\s*\([\s\S]*?\bworkflow_step_runs\b[\s\S]*?\bstep_key\s*=\s*'approval'[\s\S]*?\bapproval_request_id\b[\s\S]*?\bv_approval_id\b/i,
    );
    expect(authorize).toMatch(
      /\bcoalesce\s*\(\s*(?:pg_catalog\.)?max\s*\([\s\S]*?attempt[\s\S]*?\)\s*,\s*0\s*\)\s*\+\s*1\b/i,
    );
  });

  it("moves approval to issue_proposal only in the same transaction", () => {
    expect(authorize).toMatch(
      /\bupdate\s+public\.workflow_runs\b[\s\S]*?\bstatus\s*=\s*'running'\s*,\s*current_step\s*=\s*'issue_proposal'/i,
    );
    expect(authorize).toMatch(
      /\binsert\s+into\s+public\.audit_events\b[\s\S]*?'proposal_release_authorized'/i,
    );
  });

  it("distinguishes the workflow requester from the human decision maker", () => {
    expect(authorize).toMatch(
      /\bv_requester\s*:=\s*coalesce\s*\(\s*v_run\.initiated_by\s*,\s*v_actor\s*\)/i,
    );
    expect(authorize).toMatch(
      /\bv_self_approved\s*:=\s*v_requester\s*=\s*v_actor/i,
    );
    expect(authorize).toMatch(
      /\binsert\s+into\s+public\.approval_requests\b[\s\S]*?\brequested_by\b[\s\S]*?\bdecision_by\b[\s\S]*?\bself_approved\b[\s\S]*?\bv_requester\b[\s\S]*?\bv_actor\b[\s\S]*?\bv_self_approved\b/i,
    );
  });
});
