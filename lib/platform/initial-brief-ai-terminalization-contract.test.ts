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
  const body = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!body) return "";
  const tag = body[1]!;
  const bodyEnd = tail.indexOf(tag, body.index + body[0].length);
  return bodyEnd < 0 ? "" : tail.slice(0, bodyEnd + tag.length);
}

describe("initial brief AI terminalization infrastructure contract", () => {
  it("uses exact service-role-only RPCs for usage and failure closure", () => {
    const record = sqlFunction("record_initial_brief_ai_usage");
    const close = sqlFunction("close_initial_brief_ai_call");

    for (const [name, command] of [
      ["record_initial_brief_ai_usage", record],
      ["close_initial_brief_ai_call", close],
    ] as const) {
      expect(command, `${name} must exist`).not.toBe("");
      expect(command).toMatch(/\bsecurity\s+definer\b/i);
      expect(command).toMatch(/\bset\s+search_path\s*=\s*''/i);
      expect(migration).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
          "i",
        ),
      );
      expect(migration).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${name}[\\s\\S]*?to\\s+service_role`,
          "i",
        ),
      );
    }

    expect(record).toMatch(/\bfrom\s+public\.ai_calls\b[\s\S]*?\bfor\s+update\b/i);
    expect(record).toMatch(/\ba\.id\s*=\s*p_ai_call_id\b/i);
    expect(record).toMatch(
      /\ba\.workflow_step_run_id\s*=\s*p_workflow_step_run_id\b/i,
    );
    expect(record).toMatch(/\blifecycle_state\s*=\s*'reserved'/i);
    expect(record).toMatch(/\btokens_in\s*=\s*p_tokens_in\b/i);
    expect(record).toMatch(/\btokens_out\s*=\s*p_tokens_out\b/i);
    expect(record).toMatch(/\blifecycle_state\s*=\s*'completed'/i);
    expect(record).toMatch(
      /\blifecycle_state\s*=\s*'completed'[\s\S]*?\breturn\b/i,
    );

    expect(close).toMatch(/\bp_workflow_run_id\s+uuid\b/i);
    expect(close).toMatch(/\bp_workflow_step_run_id\s+uuid\b/i);
    expect(close).toMatch(/\bp_ai_call_id\s+uuid\b/i);
    expect(close).toMatch(/\bfrom\s+public\.ai_calls\b[\s\S]*?\bfor\s+update\b/i);
    expect(close).toMatch(
      /\bfrom\s+public\.workflow_step_runs\b[\s\S]*?\bfor\s+update\b/i,
    );
    expect(close).toMatch(
      /\bfrom\s+public\.workflow_runs\b[\s\S]*?\bfor\s+update\b/i,
    );
    expect(close).toMatch(/\blifecycle_state\s*=\s*'abandoned'/i);
    expect(close).toMatch(/\blifecycle_state\s*=\s*'reserved'/i);
    expect(close).toMatch(/\blifecycle_state\s*=\s*'completed'/i);
    expect(close).toMatch(
      /\bupdate\s+public\.workflow_step_runs\b[\s\S]*?\bstatus\s*=\s*'failed'/i,
    );
    expect(close).toMatch(
      /\bupdate\s+public\.workflow_runs\b[\s\S]*?\bstatus\s*=\s*'failed'/i,
    );
  });

  it("closes provider, usage, and finalization failures without leaking raw errors", () => {
    expect(workflow).toMatch(
      /\.rpc\(\s*"record_initial_brief_ai_usage"/,
    );
    expect(workflow).toMatch(
      /export\s+async\s+function\s+closeInitialBriefAiCall\b/,
    );
    expect(workflow).toMatch(
      /\.rpc\(\s*"close_initial_brief_ai_call"/,
    );
    expect(route).toMatch(/\bcloseInitialBriefAiCall\b/);
    expect(
      route.match(/\bcloseInitialBriefAiCall\s*\(/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(3);
    expect(route).toMatch(
      /catch\s*(?:\([^)]*\))?\s*\{[\s\S]*?closeInitialBriefAiCall\s*\(/i,
    );
    expect(route).not.toMatch(
      /NextResponse\.json\([\s\S]{0,300}?\bdetail\s*:/i,
    );
    expect(route).not.toMatch(
      /NextResponse\.json\([\s\S]{0,500}?\.(?:message|details|hint)\b/i,
    );
  });
});
