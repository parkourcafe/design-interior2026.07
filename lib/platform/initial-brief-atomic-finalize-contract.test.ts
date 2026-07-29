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
const workflow = readFileSync(
  resolve(process.cwd(), "lib/platform/m1-workflow.ts"),
  "utf8",
);
const route = readFileSync(
  resolve(process.cwd(), "app/api/intake/submit/route.ts"),
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
  const bodyTag = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!bodyTag?.[1] || bodyTag.index === undefined) return "";
  const end = tail.indexOf(
    bodyTag[1],
    bodyTag.index + bodyTag[0].length,
  );
  return end < 0 ? "" : tail.slice(0, end + bodyTag[1].length);
}

function sourceFunction(source: string, name: string): string {
  const start = source.search(
    new RegExp(`export\\s+async\\s+function\\s+${name}\\b`, "i"),
  );
  if (start < 0) return "";

  const tail = source.slice(start);
  const nextExport = tail.slice(1).search(/\nexport\s+(?:async\s+)?function\b/i);
  return nextExport < 0 ? tail : tail.slice(0, nextExport + 1);
}

describe("initial brief atomic finalization contract", () => {
  it("exposes one exact service-role-only finalization command after metered usage is durable", () => {
    const finalize = sqlFunction("finalize_initial_brief");

    expect(finalize, "finalize_initial_brief RPC must exist").not.toBe("");
    expect(finalize).toMatch(/\bsecurity\s+definer\b/i);
    expect(finalize).toMatch(/\bset\s+search_path\s*=\s*''/i);
    expect(finalize).toMatch(/\bservice_role\s+required\b/i);
    expect(finalize).toMatch(/\bp_project_id\s+uuid\b/i);
    expect(finalize).toMatch(/\bp_workflow_run_id\s+uuid\b/i);
    expect(finalize).toMatch(/\bp_workflow_step_run_id\s+uuid\b/i);
    expect(finalize).toMatch(/\bp_ai_call_id\s+uuid\b/i);
    expect(finalize).toMatch(/\bp_answer_digest\s+text\b/i);
    expect(finalize).toMatch(/\bp_answers\s+jsonb\b/i);
    expect(finalize).toMatch(/\bp_passport\s+jsonb\b/i);
    expect(finalize).toMatch(/\bp_risk_cards\s+jsonb\b/i);

    expect(migration).toMatch(
      /revoke\s+all\s+on\s+function\s+public\.finalize_initial_brief\s*\([^;]*\)\s*from\s+public\s*,\s*anon\s*,\s*authenticated/i,
    );
    expect(migration).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.finalize_initial_brief\s*\([^;]*\)\s*to\s+service_role/i,
    );
    expect(migration).not.toMatch(
      /grant\s+execute\s+on\s+function\s+public\.finalize_initial_brief\s*\([^;]*\)\s*to\s+(?:anon|authenticated)\b/i,
    );

    expect(finalize).toMatch(
      /\bfrom\s+public\.workflow_runs\b[\s\S]*?\bid\s*=\s*p_workflow_run_id\b[\s\S]*?\bproject_id\s*=\s*p_project_id\b[\s\S]*?\bworkflow_key\s*=\s*'client_intake_to_issued_proposal'[\s\S]*?\bworkflow_version\s*=\s*1\b[\s\S]*?\bfor\s+update\b/i,
    );
    expect(finalize).toMatch(
      /\bfrom\s+public\.workflow_step_runs\b[\s\S]*?\bid\s*=\s*p_workflow_step_run_id\b[\s\S]*?\bworkflow_run_id\s*=\s*p_workflow_run_id\b[\s\S]*?\bstep_key\s*=\s*'generate_risk_register'[\s\S]*?\bstatus\s*=\s*'running'[\s\S]*?\bfor\s+update\b/i,
    );
    expect(finalize).toMatch(
      /\bfrom\s+public\.ai_calls\b[\s\S]*?\bid\s*=\s*p_ai_call_id\b[\s\S]*?\bproject_id\s*=\s*p_project_id\b[\s\S]*?\bworkflow_run_id\s*=\s*p_workflow_run_id\b[\s\S]*?\bworkflow_step_run_id\s*=\s*p_workflow_step_run_id\b[\s\S]*?\baction_key\s*=\s*'generate_risk_register'[\s\S]*?\blifecycle_state\s*=\s*'completed'[\s\S]*?\brequest_digest\s*=\s*p_answer_digest\b[\s\S]*?\bfor\s+update\b/i,
    );
    expect(finalize).toMatch(
      /\b(?:input_snapshot|request_digest)[\s\S]{0,180}?['"]answer_digest['"]?[\s\S]{0,180}?p_answer_digest/i,
    );
    expect(finalize).not.toMatch(/\bupdate\s+public\.ai_calls\b/i);
    expect(finalize).not.toMatch(/\binsert\s+into\s+public\.ai_calls\b/i);
    expect(finalize).not.toMatch(/\bexception\s+when\b/i);
  });

  it("bounds and validates all JSON before atomically persisting governed and legacy M1 state", () => {
    const finalize = sqlFunction("finalize_initial_brief");

    expect(finalize, "finalize_initial_brief RPC must exist").not.toBe("");
    expect(finalize).toMatch(
      /\bjsonb_typeof\s*\(\s*p_answers\s*\)\s*(?:<>|is\s+distinct\s+from)\s*'object'/i,
    );
    expect(finalize).toMatch(
      /\bjsonb_typeof\s*\(\s*p_passport\s*\)\s*(?:<>|is\s+distinct\s+from)\s*'object'/i,
    );
    expect(finalize).toMatch(
      /\bjsonb_typeof\s*\(\s*p_risk_cards\s*\)\s*(?:<>|is\s+distinct\s+from)\s*'array'/i,
    );
    for (const payload of ["p_answers", "p_passport", "p_risk_cards"]) {
      expect(finalize).toMatch(
        new RegExp(
          `(?:pg_catalog\\.)?(?:pg_column_size|octet_length)\\s*\\(\\s*${payload}\\b[\\s\\S]{0,100}?(?:>|>=)\\s*\\d+`,
          "i",
        ),
      );
    }
    expect(finalize).toMatch(
      /\bjsonb_array_length\s*\(\s*p_risk_cards\s*\)\s*>\s*\d+/i,
    );
    expect(finalize).toMatch(
      /\bjsonb_object_keys\s*\(\s*p_passport\s*\)[\s\S]*?\bunsupported\b/i,
    );
    expect(finalize).toMatch(
      /\bjsonb_object_keys\s*\(\s*(?:v_card|card)\s*\)[\s\S]*?\bunsupported\b/i,
    );
    expect(finalize).toMatch(
      /\bjsonb_array_elements\s*\(\s*(?:v_card|card)\s*->\s*'evidence'\s*\)/i,
    );

    expect(finalize).toMatch(/\binsert\s+into\s+public\.project_sources\b/i);
    expect(finalize).toMatch(
      /\bsource_type\b[\s\S]{0,500}?'client_brief'/i,
    );
    expect(finalize).toMatch(
      /\bchecksum\b[\s\S]{0,500}?\bp_answer_digest\b/i,
    );
    expect(finalize).toMatch(/\bon\s+conflict\b[\s\S]{0,160}?\bdo\b/i);

    expect(finalize).toMatch(/\binsert\s+into\s+public\.project_facts\b/i);
    expect(finalize).toMatch(
      /\binsert\s+into\s+public\.project_facts\s*\([\s\S]*?\bsource_id\b[\s\S]*?\bevidence_locator\b[\s\S]*?\bstatus\b[\s\S]*?\bconfidence\b[\s\S]*?\bcreated_by_type\b[\s\S]*?\bversion\b[\s\S]*?\bsupersedes_id\b/i,
    );
    expect(finalize).toMatch(
      /\bfrom\s+public\.project_facts\b[\s\S]*?\bproject_id\s*=\s*p_project_id\b[\s\S]*?\bevidence_locator\b[\s\S]*?\bversion\b[\s\S]*?\bfor\s+update\b/i,
    );
    expect(finalize).toMatch(/\bcreated_by_type\b[\s\S]{0,600}?'system'/i);
    expect(finalize).not.toMatch(/\b(?:update|delete\s+from)\s+public\.project_facts\b/i);
    expect(finalize).not.toMatch(/'human_confirmed'/i);

    expect(finalize).toMatch(
      /\bupdate\s+public\.projects\b[\s\S]*?\bpassport\s*=\s*p_passport\b[\s\S]*?\bclient_name\b[\s\S]*?\bstatus\s*=\s*'brief_completed'[\s\S]*?\bwhere\s+id\s*=\s*p_project_id\b/i,
    );

    const riskDelete = finalize.match(
      /\bdelete\s+from\s+public\.risk_cards\b[\s\S]*?;/i,
    )?.[0];
    expect(riskDelete, "risk replacement must be explicit").toBeDefined();
    expect(riskDelete).toMatch(/\bproject_id\s*=\s*p_project_id\b/i);
    expect(riskDelete).toMatch(/\bstatus\s*=\s*'proposed'/i);
    expect(riskDelete).not.toMatch(/'accepted'|'rejected'/i);
    expect(finalize).toMatch(
      /\binsert\s+into\s+public\.risk_cards\b[\s\S]*?'proposed'/i,
    );

    expect(finalize).toMatch(
      /\binsert\s+into\s+public\.events\b[\s\S]*?\btype\b[\s\S]*?'brief_completed'/i,
    );
  });

  it("completes the exact steps, opens human review, audits it, and merges snapshots", () => {
    const finalize = sqlFunction("finalize_initial_brief");

    expect(finalize, "finalize_initial_brief RPC must exist").not.toBe("");
    for (const step of [
      "extract_client_brief",
      "build_project_passport",
      "generate_risk_register",
    ]) {
      expect(finalize).toMatch(
        new RegExp(
          `(?:insert\\s+into|update)\\s+public\\.workflow_step_runs\\b[\\s\\S]*?['"]${step}['"][\\s\\S]*?['"]completed['"]`,
          "i",
        ),
      );
    }
    expect(finalize).toMatch(
      /\binsert\s+into\s+public\.approval_requests\b[\s\S]*?'project_facts'[\s\S]*?'INTERNAL_REVIEWED'[\s\S]*?'pending'/i,
    );
    expect(finalize).toMatch(
      /\binsert\s+into\s+public\.audit_events\b[\s\S]*?'brief_workflow_waiting_for_review'/i,
    );
    expect(finalize).toMatch(
      /\bupdate\s+public\.workflow_runs\b[\s\S]*?\bstatus\s*=\s*'waiting_for_human'[\s\S]*?\bcurrent_step\s*=\s*'human_review'/i,
    );

    const snapshotMerges =
      finalize.match(
        /\boutput_snapshot\s*=\s*(?:pg_catalog\.)?coalesce\s*\(\s*output_snapshot\s*,\s*'\{\}'::jsonb\s*\)\s*\|\|/gi,
      ) ?? [];
    expect(
      snapshotMerges.length,
      "risk-step and workflow-run snapshots must preserve reservation evidence",
    ).toBeGreaterThanOrEqual(2);
    expect(finalize).not.toMatch(
      /\boutput_snapshot\s*=\s*p_(?:answers|passport|risk_cards)\b/i,
    );
  });

  it("routes post-provider persistence through the one checked finalizer and checks every closure result", () => {
    const adapter = sourceFunction(workflow, "finalizeInitialBrief");
    expect(adapter, "finalizeInitialBrief adapter must exist").not.toBe("");
    expect(adapter).toMatch(/\.rpc\(\s*["']finalize_initial_brief["']/i);
    expect(adapter).not.toMatch(/\.from\s*\(/i);
    for (const parameter of [
      "p_project_id",
      "p_workflow_run_id",
      "p_workflow_step_run_id",
      "p_ai_call_id",
      "p_answer_digest",
      "p_answers",
      "p_passport",
      "p_risk_cards",
    ]) {
      expect(adapter).toMatch(new RegExp(`\\b${parameter}\\s*:`, "i"));
    }

    const providerStart = route.search(/await\s+runRiskPipeline\s*\(/i);
    expect(providerStart, "route must invoke the risk pipeline").toBeGreaterThan(-1);
    const afterProvider = route.slice(providerStart);
    expect(
      afterProvider.match(/\bawait\s+finalizeInitialBrief\s*\(/g)?.length ?? 0,
    ).toBe(1);
    expect(afterProvider).toMatch(
      /\b(?:const|let)\s+([a-z_][a-z0-9_]*)\s*=\s*await\s+finalizeInitialBrief\s*\([\s\S]*?\bif\s*\(\s*!\s*\1\.ok\b/i,
    );
    expect(afterProvider).not.toMatch(/\bpersistBriefWorkflow\s*\(/i);
    for (const table of [
      "answers",
      "projects",
      "risk_cards",
      "events",
      "project_sources",
      "project_facts",
      "workflow_runs",
      "workflow_step_runs",
      "approval_requests",
      "audit_events",
    ]) {
      expect(afterProvider).not.toMatch(
        new RegExp(`\\.from\\s*\\(\\s*["']${table}["']\\s*\\)`, "i"),
      );
    }

    const closeCalls = [...route.matchAll(/\bawait\s+closeInitialBriefAiCall\s*\(/g)];
    expect(closeCalls.length, "failure paths must close the reservation").toBeGreaterThan(0);
    for (const call of closeCalls) {
      const start = Math.max(0, (call.index ?? 0) - 120);
      const window = route.slice(start, (call.index ?? 0) + 900);
      const assignment = window.match(
        /\b(?:const|let)\s+([a-z0-9_]*clos[a-z0-9_]*)\s*=\s*await\s+closeInitialBriefAiCall\s*\(/i,
      );
      expect(
        assignment?.[1],
        "every closeInitialBriefAiCall result must be retained",
      ).toBeDefined();
      expect(window).toMatch(
        new RegExp(
          `\\bif\\s*\\(\\s*!\\s*${assignment?.[1] ?? "__missing__"}\\.ok\\b`,
          "i",
        ),
      );
    }
  });

  it("locks project before workflow, step, and AI rows to match reservation order", () => {
    const finalize = sqlFunction("finalize_initial_brief");
    const projectLock = finalize.search(
      /\bfrom\s+public\.projects\b[\s\S]{0,320}?\bfor\s+update\b/i,
    );
    const workflowLock = finalize.search(
      /\bfrom\s+public\.workflow_runs\b[\s\S]{0,500}?\bfor\s+update\b/i,
    );
    const stepLock = finalize.search(
      /\bfrom\s+public\.workflow_step_runs\b[\s\S]{0,500}?\bfor\s+update\b/i,
    );
    const aiLock = finalize.search(
      /\bfrom\s+public\.ai_calls\b[\s\S]{0,700}?\bfor\s+update\b/i,
    );

    expect(projectLock).toBeGreaterThanOrEqual(0);
    expect(workflowLock).toBeGreaterThan(projectLock);
    expect(stepLock).toBeGreaterThan(workflowLock);
    expect(aiLock).toBeGreaterThan(stepLock);
  });
});
