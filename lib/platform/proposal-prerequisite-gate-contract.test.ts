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

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function extractFunctionDefinition(functionName: string): string {
  const header = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${escapeRegExp(functionName)}\\s*\\(`,
    "i",
  ).exec(migrationSql);

  expect(header, `${functionName} must be defined`).not.toBeNull();
  if (!header) throw new Error(`${functionName} is missing`);

  const tail = migrationSql.slice(header.index);
  const bodyMarker = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  const delimiter = bodyMarker?.[1];
  expect(delimiter, `${functionName} must use a dollar-quoted body`).toBeTruthy();
  if (!bodyMarker || !delimiter) throw new Error(`${functionName} body is missing`);

  const bodyStart = bodyMarker.index + bodyMarker[0].length;
  const bodyEnd = tail.indexOf(delimiter, bodyStart);
  expect(bodyEnd, `${functionName} body must be closed`).toBeGreaterThan(bodyStart);

  return tail.slice(0, bodyEnd + delimiter.length);
}

const command = extractFunctionDefinition(
  "public.persist_m1_proposal_draft_steps",
);

describe("M1 proposal-draft prerequisite gate", () => {
  it("keeps the authenticated studio-member boundary on the command", () => {
    expect(command).toMatch(/\bauth\.uid\(\)\s+is\s+null\b/i);
    expect(command).toMatch(/\bprivate\.is_studio_member\s*\(/i);
    expect(command).toMatch(/\bsecurity\s+definer\b/i);
    expect(command).toMatch(/\bset\s+search_path\s*=\s*''/i);
  });

  it("selects the exact workflow run through its approved INTERNAL_REVIEWED decision", () => {
    const reviewedRunSelection =
      /\bselect\b[\s\S]*?\binto\s+v_run\b([\s\S]*?)\bfor\s+update(?:\s+of\s+[a-z_][a-z0-9_$]*)?/i.exec(
        command,
      )?.[1];

    expect(
      reviewedRunSelection,
      "the run must be selected and locked before proposal progress is written",
    ).toBeTruthy();
    if (!reviewedRunSelection) throw new Error("reviewed run selection is missing");

    expect(reviewedRunSelection).toMatch(
      /\b(?:from|join)\s+public\.approval_requests\b/i,
    );
    expect(reviewedRunSelection).toMatch(
      /\b(?:from|join)\s+public\.workflow_runs\b/i,
    );
    expect(reviewedRunSelection).toMatch(
      /\b(?:[a-z_][a-z0-9_$]*\.)?workflow_run_id\s*=\s*(?:[a-z_][a-z0-9_$]*\.)?id\b|\b(?:[a-z_][a-z0-9_$]*\.)?id\s*=\s*(?:[a-z_][a-z0-9_$]*\.)?workflow_run_id\b/i,
    );
    expect(reviewedRunSelection).toMatch(
      /\bapproval_type\s*=\s*'INTERNAL_REVIEWED'/i,
    );
    expect(reviewedRunSelection).toMatch(/\bstatus\s*=\s*'approved'/i);
    expect(
      reviewedRunSelection.match(/\bproject_id\s*=\s*p_project_id\b/gi)?.length ??
        0,
      "both the approval and selected run must be bound to the requested project",
    ).toBeGreaterThanOrEqual(2);
    expect(reviewedRunSelection).toMatch(
      /\bworkflow_key\s*=\s*'client_intake_to_issued_proposal'/i,
    );
    expect(reviewedRunSelection).toMatch(/\bworkflow_version\s*=\s*1\b/i);
    expect(reviewedRunSelection).toMatch(
      /\bstatus\s*=\s*'running'/i,
    );
    expect(reviewedRunSelection).toMatch(
      /\bcurrent_step\s*=\s*'generate_clarifying_questions'/i,
    );
    expect(reviewedRunSelection).toMatch(
      /\bstatus\s*=\s*'waiting_for_human'/i,
    );
    expect(reviewedRunSelection).toMatch(
      /\bcurrent_step\s*=\s*'approval'/i,
    );
    expect(reviewedRunSelection).not.toMatch(
      /\bcurrent_step\s*=\s*'human_review'/i,
    );

    expect(
      reviewedRunSelection,
      "the proposal page must not choose whichever active run happens to be newest",
    ).not.toMatch(
      /\border\s+by\b[\s\S]*?\blimit\s+1\b/i,
    );
  });

  it.each([
    "extract_client_brief",
    "build_project_passport",
    "generate_risk_register",
  ])(
    "requires a completed %s step on that exact approved run",
    (stepKey) => {
      const sameRunCompletedStep = new RegExp(
        String.raw`\bfrom\s+public\.workflow_step_runs\s+(?:as\s+)?([a-z_][a-z0-9_$]*)(?=[\s\S]{0,700}?\b\1\.workflow_run_id\s*=\s*v_run\.id\b)(?=[\s\S]{0,700}?\b\1\.step_key\s*=\s*'${escapeRegExp(stepKey)}')(?=[\s\S]{0,700}?\b\1\.status\s*=\s*'completed')`,
        "i",
      );

      expect(
        command,
        `${stepKey} must be completed on the same run selected by INTERNAL_REVIEWED`,
      ).toMatch(sameRunCompletedStep);
    },
  );

  it("does not synthesize a run or revive an arbitrary pre-review state when the page opens", () => {
    expect(command).not.toMatch(/\binsert\s+into\s+public\.workflow_runs\b/i);
    expect(command).not.toMatch(
      /\bstatus\s+in\s*\([^)]*'(?:queued|failed|retrying|pending_cost_confirmation)'/i,
    );
    expect(command).not.toMatch(
      /\bv_run\.status\s+in\s*\([^)]*'(?:queued|failed|retrying|pending_cost_confirmation)'/i,
    );

  });

  it("uses a compare-and-set guard on the canonical drafting state before writing progress", () => {
    const compareAndSet =
      /\bupdate\s+public\.workflow_runs\b[\s\S]{0,900}?\bwhere\s+id\s*=\s*v_run\.id\b(?=[\s\S]{0,300}?\band\s+status\s*=\s*'running')(?=[\s\S]{0,300}?\band\s+current_step\s*=\s*'generate_clarifying_questions')/i.exec(
        command,
      );

    expect(
      compareAndSet,
      "progress must atomically retain the exact canonical drafting state",
    ).not.toBeNull();
    if (!compareAndSet) throw new Error("drafting-state compare-and-set is missing");

    expect(
      compareAndSet.index,
      "the state transition must win before any downstream step is completed",
    ).toBeLessThan(
      command.indexOf("insert into public.workflow_step_runs"),
    );
    const afterCompareAndSet = command.slice(
      compareAndSet.index + compareAndSet[0].length,
      compareAndSet.index + compareAndSet[0].length + 700,
    );
    expect(afterCompareAndSet).toMatch(
      /;\s*if\s+not\s+found\s+then\b[\s\S]{0,300}?\braise\s+exception\b/i,
    );
  });
});
