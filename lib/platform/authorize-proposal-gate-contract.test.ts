import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
  ),
  "utf8",
);

function extractFunctionDefinition(functionName: string): string {
  const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\(`,
    "i",
  ).exec(migrationSql);
  if (!header) return "";

  const tail = migrationSql.slice(header.index);
  const bodyMarker = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!bodyMarker?.[1]) return "";
  const bodyStart = bodyMarker.index + bodyMarker[0].length;
  const bodyEnd = tail.indexOf(bodyMarker[1], bodyStart);
  return bodyEnd < 0 ? "" : tail.slice(0, bodyEnd + bodyMarker[1].length);
}

const command = extractFunctionDefinition(
  "public.authorize_proposal_revision",
);

describe("M1 proposal release-authorization gate", () => {
  it("is an authenticated studio-member command in the additive migration", () => {
    expect(command, "authorize_proposal_revision must be replaced additively").not.toBe("");
    expect(command).toMatch(/\bsecurity\s+definer\b/i);
    expect(command).toMatch(/\bset\s+search_path\s*=\s*''/i);
    expect(command).toMatch(/\bauth\.uid\(\)\s+is\s+null\b/i);
    expect(command).toMatch(/\bprivate\.is_studio_member\s*\(/i);
  });

  it("locks the exact requested v1 run at approval and denies the legacy human-review shortcut", () => {
    expect(command, "authorize_proposal_revision must be replaced additively").not.toBe("");
    expect(command).toMatch(/\bpr\.id\s*=\s*p_proposal_id\b/i);
    expect(command).toMatch(/\bw\.id\s*=\s*p_workflow_run_id\b/i);
    expect(command).toMatch(
      /\bw\.project_id\s*=\s*v_proposal\.project_id\b/i,
    );
    expect(command).toMatch(
      /\bw\.workflow_key\s*=\s*'client_intake_to_issued_proposal'/i,
    );
    expect(command).toMatch(/\bw\.workflow_version\s*=\s*1\b/i);
    expect(command).toMatch(
      /\bw\.status\s*=\s*'waiting_for_human'[\s\S]{0,180}?\bw\.current_step\s*=\s*'approval'/i,
    );
    expect(command).toMatch(
      /\bw\.status\s*=\s*'running'[\s\S]{0,180}?\bw\.current_step\s*=\s*'issue_proposal'/i,
    );
    expect(command).not.toMatch(/'human_review'/i);
    expect(command).not.toMatch(
      /\border\s+by\s+w\.[\s\S]{0,160}?\blimit\s+1\b/i,
    );
  });

  it("reuses only one approved RELEASE_AUTHORIZED revision with the exact proposal/run/project binding", () => {
    expect(command, "authorize_proposal_revision must be replaced additively").not.toBe("");
    expect(command).toMatch(/\bfrom\s+public\.proposal_revisions\s+r\b/i);
    expect(command).toMatch(
      /\bjoin\s+public\.approval_requests\s+a\s+on\s+a\.proposal_revision_id\s*=\s*r\.id\b/i,
    );
    for (const binding of [
      /\ba\.workflow_run_id\s*=\s*v_run\.id\b/i,
      /\ba\.project_id\s*=\s*v_proposal\.project_id\b/i,
      /\ba\.subject_type\s*=\s*'proposal'/i,
      /\ba\.subject_id\s*=\s*v_proposal\.id\b/i,
      /\ba\.approval_type\s*=\s*'RELEASE_AUTHORIZED'/i,
      /\ba\.status\s*=\s*'approved'/i,
      /\br\.proposal_id\s*=\s*v_proposal\.id\b/i,
      /\br\.project_id\s*=\s*v_proposal\.project_id\b/i,
      /\br\.sections\s*=\s*v_proposal\.sections\b/i,
    ]) {
      expect(command).toMatch(binding);
    }
    expect(command).not.toMatch(
      /\ba\.status\s+in\s*\([^)]*'pending'/i,
    );
  });

  it("permits running/issue_proposal only as an exact idempotent reuse", () => {
    expect(command, "authorize_proposal_revision must be replaced additively").not.toBe("");
    expect(command).toMatch(
      /\bif\s+v_approval_id\s+is\s+not\s+null\s+then\b[\s\S]*?\breturn\s+v_approval_id\s*;/i,
    );
    expect(command).toMatch(
      /\bif\s+v_run\.status\s*=\s*'running'\s+then\b[\s\S]{0,260}?\braise\s+exception\b/i,
    );
  });

  it("CAS-transitions only approval to running/issue_proposal", () => {
    expect(command, "authorize_proposal_revision must be replaced additively").not.toBe("");
    const compareAndSet =
      /\bupdate\s+public\.workflow_runs\b[\s\S]{0,700}?\bset\s+status\s*=\s*'running'[\s\S]{0,180}?\bcurrent_step\s*=\s*'issue_proposal'[\s\S]{0,400}?\bwhere\s+id\s*=\s*v_run\.id\b(?=[\s\S]{0,260}?\band\s+status\s*=\s*'waiting_for_human')(?=[\s\S]{0,260}?\band\s+current_step\s*=\s*'approval')/i.exec(
        command,
      );

    expect(compareAndSet, "release authorization needs an exact CAS").not.toBeNull();
    if (!compareAndSet) throw new Error("release authorization CAS is missing");
    expect(
      command.slice(
        compareAndSet.index + compareAndSet[0].length,
        compareAndSet.index + compareAndSet[0].length + 500,
      ),
    ).toMatch(/;\s*if\s+not\s+found\s+then\b[\s\S]{0,260}?\braise\s+exception\b/i);
  });
});
