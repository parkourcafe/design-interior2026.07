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
const proposalPageSource = readFileSync(
  join(process.cwd(), "app/dashboard/projects/[id]/proposal/page.tsx"),
  "utf8",
);
const projectPageSource = readFileSync(
  join(process.cwd(), "app/dashboard/projects/[id]/page.tsx"),
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

describe("legacy M1 workflow adoption bridge", () => {
  const command = extractFunctionDefinition("public.adopt_legacy_m1_workflow");

  it("is an authenticated, studio-scoped, non-service-role command for an unsent persisted brief", () => {
    expect(command).toMatch(/\bsecurity\s+definer\b/i);
    expect(command).toMatch(/\bset\s+search_path\s*=\s*''/i);
    expect(command).toMatch(/\bauth\.uid\(\)\s+is\s+null\b/i);
    expect(command).toMatch(/\bprivate\.is_studio_member\s*\(/i);
    expect(command).toMatch(
      /\bfrom\s+public\.projects\b[\s\S]*?\bfor\s+update\b/i,
    );
    expect(command).toMatch(/\bpassport\s+is\s+null\b/i);
    expect(command).toMatch(
      /\bstatus\s+not\s+in\s*\(\s*'brief_completed'\s*,\s*'proposal_draft'\s*\)/i,
    );
    expect(command).toMatch(
      /\bfrom\s+public\.proposals\b[\s\S]*?\bstatus\s*=\s*'sent'/i,
    );
    expect(command).not.toMatch(/service[_-]?role|SUPABASE_SERVICE_ROLE_KEY/i);
  });

  it("serializes adoption and never revives or duplicates an unrelated governed run", () => {
    const projectLock = command.search(
      /\bfrom\s+public\.projects\b[\s\S]*?\bfor\s+update\b/i,
    );
    const runInsert = command.search(/\binsert\s+into\s+public\.workflow_runs\b/i);

    expect(projectLock).toBeGreaterThanOrEqual(0);
    expect(runInsert).toBeGreaterThan(projectLock);
    expect(command).toMatch(
      /\bworkflow_key\s*=\s*'client_intake_to_issued_proposal'/i,
    );
    expect(command).toMatch(/\bworkflow_version\s*=\s*1\b/i);
    expect(command).toMatch(
      /\bstatus\s+in\s*\(\s*'queued'\s*,\s*'running'\s*,\s*'waiting_for_human'\s*,\s*'pending_cost_confirmation'\s*,\s*'retrying'\s*,\s*'failed'\s*\)/i,
    );
    expect(command).toMatch(
      /\bif\s+found\s+then\b[\s\S]*?\bstatus\s*<>\s*'waiting_for_human'[\s\S]*?\bcurrent_step\s*<>\s*'human_review'[\s\S]*?\braise\s+exception\b/i,
    );
    expect(command).toMatch(
      /\bif\s+exists\s*\([\s\S]*?\bfrom\s+public\.workflow_runs\b[\s\S]*?\braise\s+exception\s+'existing governed workflow cannot be adopted as legacy'/i,
    );
    expect(command).not.toMatch(
      /\bupdate\s+public\.workflow_runs\b[\s\S]*?\bstatus\s*=\s*'(?:running|retrying)'/i,
    );
  });

  it("creates bounded prerequisite evidence and stops at pending human review", () => {
    expect(command).toMatch(
      /\binsert\s+into\s+public\.workflow_runs\b[\s\S]*?'waiting_for_human'[\s\S]*?'human_review'/i,
    );

    for (const stepKey of [
      "extract_client_brief",
      "build_project_passport",
      "generate_risk_register",
    ]) {
      expect(command).toMatch(
        new RegExp(
          String.raw`\binsert\s+into\s+public\.workflow_step_runs\b[\s\S]*?'${stepKey}'[\s\S]*?'completed'`,
          "i",
        ),
      );
    }

    expect(command).toMatch(/\bfrom\s+public\.answers\b/i);
    expect(command).toMatch(/\bfrom\s+public\.risk_cards\b/i);
    expect(command).toMatch(/'answer_count'/i);
    expect(command).toMatch(/'risk_card_count'/i);
    expect(command).toMatch(/'passport_present'\s*,\s*true/i);
    expect(command).toMatch(/'metering_provenance'\s*,\s*'unavailable_legacy'/i);
    expect(command).not.toMatch(
      /jsonb_build_object\s*\([\s\S]{0,300}?'passport'\s*,\s*v_project\.passport/i,
    );
    expect(command).not.toMatch(/\binsert\s+into\s+public\.ai_calls\b/i);

    expect(command).toMatch(
      /\binsert\s+into\s+public\.approval_requests\b[\s\S]*?'INTERNAL_REVIEWED'[\s\S]*?'pending'/i,
    );
    expect(command).toMatch(/\bdecision_by\b[\s\S]*?\bnull\b/i);
    expect(command).toMatch(/\bself_approved\b[\s\S]*?\bfalse\b/i);
    expect(command).not.toMatch(/'approved'/i);
    expect(command).not.toMatch(/'issue_proposal'/i);
  });

  it("locks and digest-binds the exact persisted answers, passport, and risk evidence", () => {
    expect(command).toMatch(
      /\bperform\b[\s\S]*?\bfrom\s+public\.answers\b[\s\S]*?\bfor\s+update\b/i,
    );
    expect(command).toMatch(
      /\bperform\b[\s\S]*?\bfrom\s+public\.risk_cards\b[\s\S]*?\bfor\s+update\b/i,
    );
    expect(command).toMatch(
      /\bjsonb_object_agg\b[\s\S]*?\border\s+by\b[\s\S]*?\binto\s+v_answers_snapshot\b/i,
    );
    expect(command).toMatch(
      /\bjsonb_agg\b[\s\S]*?\border\s+by\b[\s\S]*?\binto\s+v_risk_snapshot\b/i,
    );
    expect(command).toMatch(/\bv_passport_snapshot\s*:=\s*v_project\.passport\b/i);
    expect(command).toMatch(/\bextname\s*=\s*'pgcrypto'/i);

    for (const digest of [
      "v_answers_digest",
      "v_passport_digest",
      "v_risk_digest",
    ]) {
      expect(command).toMatch(
        new RegExp(
          String.raw`\binto\s+${digest}\b[\s\S]{0,160}?\busing\b`,
          "i",
        ),
      );
      expect(command).toMatch(
        new RegExp(String.raw`'${digest.replace(/^v_/, "")}'\s*,\s*${digest}\b`, "i"),
      );
    }
  });

  it("backfills immutable source-bound facts before requesting their review", () => {
    const sourceInsert = command.search(
      /\binsert\s+into\s+public\.project_sources\b/i,
    );
    const factInsert = command.search(
      /\binsert\s+into\s+public\.project_facts\b/i,
    );
    const approvalInsert = command.search(
      /\binsert\s+into\s+public\.approval_requests\b/i,
    );

    expect(sourceInsert).toBeGreaterThanOrEqual(0);
    expect(factInsert).toBeGreaterThan(sourceInsert);
    expect(approvalInsert).toBeGreaterThan(factInsert);
    expect(command.match(/\binsert\s+into\s+public\.project_sources\b/gi)?.length)
      .toBeGreaterThanOrEqual(3);
    expect(command.match(/\binsert\s+into\s+public\.project_facts\b/gi)?.length)
      .toBeGreaterThanOrEqual(3);

    expect(command).toMatch(/'client_brief'[\s\S]*?\bv_answers_digest\b/i);
    expect(command).toMatch(/'system'[\s\S]*?\bv_passport_digest\b/i);
    expect(command).toMatch(/'system'[\s\S]*?\bv_risk_digest\b/i);
    expect(command).toMatch(/\bevidence_locator\b/i);
    expect(command).toMatch(/\bsource_id\b/i);
    expect(command).toMatch(/\bcreated_by_type\b/i);
    expect(command).toMatch(/\bversion\b/i);
    expect(command).toMatch(/\bsupersedes_id\b/i);
    expect(command).toMatch(
      /\bfrom\s+public\.project_facts\b[\s\S]*?\border\s+by\b[\s\S]*?\bversion\s+desc[\s\S]*?\bfor\s+update\b/i,
    );
    expect(command).toMatch(/'answers\.'\s*\|\|\s*v_answer\.question_id/i);
    expect(command).toMatch(/'projects\.passport'/i);
    expect(command).toMatch(/'risk_cards\.'\s*\|\|\s*v_risk\.id::text/i);
  });

  it("classifies SQL/JSON null answers as unknown and never supersedes a human decision", () => {
    expect(command).toMatch(
      /\bwhen\s+v_answer\.value\s+is\s+null[\s\S]*?\bthen\s+'unknown'/i,
    );
    expect(command).toMatch(
      /\bwhen\s+v_fact_status\s*=\s*'unknown'\s+then\s+0\b/i,
    );
    expect(command).toMatch(
      /\bselect\b[\s\S]*?\bfact\.status\b[\s\S]*?\binto\b[\s\S]*?\bv_previous_fact_status\b/i,
    );
    expect(
      command.match(
        /\bv_previous_fact_status\s+in\s*\(\s*'human_confirmed'\s*,\s*'rejected'\s*\)/gi,
      )?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(command).toMatch(
      /\braise\s+exception\s+'legacy fact requires explicit reconciliation'/i,
    );
  });

  it("is auditable and grants only authenticated execution", () => {
    expect(command).toMatch(
      /\binsert\s+into\s+public\.audit_events\b[\s\S]*?'legacy_m1_workflow_adopted'/i,
    );
    expect(command).not.toMatch(/\bupdate\s+public\.proposals\b/i);
    expect(command).not.toMatch(/\bupdate\s+public\.projects\b/i);

    expect(migrationSql).toMatch(
      /\brevoke\s+all\s+on\s+function\s+public\.adopt_legacy_m1_workflow\s*\(\s*uuid\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\b/i,
    );
    expect(migrationSql).toMatch(
      /\bgrant\s+execute\s+on\s+function\s+public\.adopt_legacy_m1_workflow\s*\(\s*uuid\s*\)\s+to\s+authenticated\b/i,
    );
  });

  it("gates proposal draft reads and writes before adopting or redirecting to review", () => {
    const workflowRead = proposalPageSource.indexOf('.from("workflow_runs")');
    const adoptionCall = proposalPageSource.indexOf(
      '.rpc("adopt_legacy_m1_workflow"',
    );
    const proposalRead = proposalPageSource.indexOf('.from("proposals")');

    expect(workflowRead).toBeGreaterThanOrEqual(0);
    expect(adoptionCall).toBeGreaterThan(workflowRead);
    expect(proposalRead).toBeGreaterThan(adoptionCall);

    const gateSource = proposalPageSource.slice(workflowRead, proposalRead);
    expect(gateSource).toMatch(
      /\bworkflow_version\b[\s\S]*?\b1\b/i,
    );
    expect(gateSource).toMatch(
      /\bwaiting_for_human\b[\s\S]*?\bhuman_review\b[\s\S]*?\bredirect\s*\(/i,
    );
    expect(gateSource).toMatch(
      /adopt_legacy_m1_workflow[\s\S]*?\bif\s*\([^)]*(?:error|!adopted)[^)]*\)[\s\S]*?\bthrow\b/i,
    );
    expect(gateSource).toMatch(
      /adopt_legacy_m1_workflow[\s\S]*?\bredirect\s*\(/i,
    );
  });

  it("keeps legacy projects adoptable through the normal Review Board CTA", () => {
    expect(projectPageSource).toMatch(
      /workflow\s*\?\s*\([\s\S]*?\)\s*:\s*\(\s*<Link\b[\s\S]*?href=\{`\/dashboard\/projects\/\$\{project\.id\}\/proposal`\}[\s\S]*?\{ru\.review\.buildProposal\}/i,
    );
    expect(projectPageSource).not.toMatch(
      /workflow\s*\?\s*\([\s\S]*?\)\s*:\s*\(\s*<button\b[^>]*\bdisabled\b/i,
    );
  });
});
