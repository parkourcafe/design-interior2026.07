import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const routeSource = readSource("app/api/intake/submit/route.ts");
const workflowSource = readSource("lib/platform/m1-workflow.ts");
const migrationSource = readSource(
  "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
);

function sqlFunction(name: string): string {
  const start = migrationSource.search(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
      "i",
    ),
  );
  if (start < 0) return "";

  const tail = migrationSource.slice(start);
  const bodyTag = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!bodyTag?.[1] || bodyTag.index === undefined) return "";

  const bodyEnd = tail.indexOf(
    bodyTag[1],
    bodyTag.index + bodyTag[0].length,
  );
  return bodyEnd < 0 ? "" : tail.slice(0, bodyEnd + bodyTag[1].length);
}

function callWindow(
  source: string,
  startPattern: RegExp,
  endPattern: RegExp,
): string {
  const start = source.search(startPattern);
  if (start < 0) return "";
  const tail = source.slice(start);
  const end = tail.search(endPattern);
  return end < 0 ? tail : tail.slice(0, end);
}

describe("initial brief request idempotency contract", () => {
  it("derives a canonical answer digest and passes digest-based identity, not answer keys", () => {
    const identitySource = `${routeSource}\n${workflowSource}`;
    const reserveCall = callWindow(
      routeSource,
      /reserveInitialBriefAiCall\s*\(/,
      /\n\s*(?:if|const|let|try)\b/,
    );

    expect(
      identitySource,
      "the request identity must hash a canonical/stably serialized answer snapshot",
    ).toMatch(
      /(?:(?:canonical|stable)[\s\S]{0,500}?(?:createHash\s*\(\s*["'`]sha256["'`]\s*\)|sha256)|(?:createHash\s*\(\s*["'`]sha256["'`]\s*\)|sha256)[\s\S]{0,500}?(?:canonical|stable))/i,
    );
    expect(reserveCall).toMatch(/\banswerDigest\s*:/);
    expect(reserveCall).toMatch(/\bidempotencyKey\s*:/);
    expect(reserveCall).not.toMatch(/\banswerKeys\s*:/);

    expect(workflowSource).toMatch(
      /input\s*:\s*\{[\s\S]{0,240}?\banswerDigest\s*:\s*string[\s\S]{0,160}?\bidempotencyKey\s*:\s*string/i,
    );
    expect(workflowSource).toMatch(/\bp_answer_digest\s*:\s*input\.answerDigest\b/);
    expect(workflowSource).toMatch(
      /\bp_idempotency_key\s*:\s*input\.idempotencyKey\b/,
    );
  });

  it("binds the digest identity to the versioned run, step, and AI reservation", () => {
    const reserve = sqlFunction("reserve_initial_brief_ai_call");

    expect(reserve, "reservation RPC must exist").not.toBe("");
    expect(reserve).toMatch(/\bp_answer_digest\s+text\b/i);
    expect(reserve).toMatch(/\bp_idempotency_key\s+text\b/i);
    expect(reserve).toMatch(/\bp_answer_digest\s*!~\s*['"]\^\[0-9A-Fa-f\]\{64\}\$['"]/i);
    expect(reserve).toMatch(/\bp_idempotency_key\s*!~\s*['"]\^\[0-9A-Fa-f\]\{64\}\$['"]/i);

    expect(reserve).toMatch(
      /\bworkflow_key\s*=\s*'client_intake_to_issued_proposal'[\s\S]{0,180}?\bworkflow_version\s*=\s*1\b/i,
    );
    expect(reserve).toMatch(
      /\bfrom\s+public\.projects\b[\s\S]{0,180}?\bfor\s+update\b/i,
    );

    expect(reserve).toMatch(
      /\binsert\s+into\s+public\.workflow_runs\b[\s\S]{0,900}?['"]answer_digest['"]\s*,\s*p_answer_digest[\s\S]{0,240}?['"]idempotency_key['"]\s*,\s*p_idempotency_key/i,
    );
    expect(reserve).toMatch(
      /\binsert\s+into\s+public\.workflow_step_runs\b[\s\S]{0,900}?['"]answer_digest['"]\s*,\s*p_answer_digest[\s\S]{0,240}?['"]idempotency_key['"]\s*,\s*p_idempotency_key/i,
    );

    expect(migrationSource).toMatch(
      /\balter\s+table\s+public\.ai_calls\b[\s\S]{0,320}?\badd\s+column\s+if\s+not\s+exists\s+(?:request_digest|answer_digest)\s+text\b/i,
    );
    expect(migrationSource).toMatch(
      /\balter\s+table\s+public\.ai_calls\b[\s\S]{0,420}?\badd\s+column\s+if\s+not\s+exists\s+idempotency_key\s+text\b/i,
    );
    expect(reserve).toMatch(
      /\binsert\s+into\s+public\.ai_calls\s*\([\s\S]{0,420}?\b(?:request_digest|answer_digest)\b[\s\S]{0,180}?\bidempotency_key\b/i,
    );
    expect(reserve).toMatch(
      /\bvalues\s*\([\s\S]{0,520}?\bp_answer_digest\b[\s\S]{0,180}?\bp_idempotency_key\b/i,
    );
  });

  it("replays the exact completed reservation/result and rejects an active conflicting digest", () => {
    const reserve = sqlFunction("reserve_initial_brief_ai_call");
    const beforeProvider = callWindow(
      routeSource,
      /await\s+reserveInitialBriefAiCall\s*\(/,
      /await\s+runRiskPipeline\s*\(/,
    );

    expect(reserve).toMatch(
      /\bfrom\s+public\.ai_calls\b[\s\S]{0,600}?\b(?:request_digest|answer_digest)\s*=\s*p_answer_digest[\s\S]{0,260}?\bidempotency_key\s*=\s*p_idempotency_key[\s\S]{0,260}?\blifecycle_state\s*=\s*'completed'/i,
    );
    expect(reserve).toMatch(
      /\breturn\s+jsonb_build_object\s*\([\s\S]{0,700}?['"]workflow_run_id['"][\s\S]*?['"]workflow_step_run_id['"][\s\S]*?['"]ai_call_id['"][\s\S]*?['"]replayed['"]\s*,\s*true[\s\S]*?['"]result_snapshot['"]/i,
    );
    expect(reserve).toMatch(
      /\braise\s+exception\s+['"]initial_brief_request_conflict['"]/i,
    );

    expect(
      beforeProvider,
      "a completed replay must return before the metered provider is invoked",
    ).toMatch(
      /\bif\s*\([\s\S]{0,180}?\breservation\.(?:replayed|reused|isReplay)\b[\s\S]{0,500}?\breturn\s+NextResponse\.json\s*\([\s\S]{0,300}?(?:result|response)Snapshot/i,
    );
  });
});
