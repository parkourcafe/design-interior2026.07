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

function sqlFunction(schema: string, name: string): string {
  const start = migration.search(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+${schema}\\.${name}\\s*\\(`,
      "i",
    ),
  );
  if (start < 0) return "";

  const tail = migration.slice(start);
  const bodyTag = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!bodyTag?.[1] || bodyTag.index === undefined) return "";
  const bodyEnd = tail.indexOf(
    bodyTag[1],
    bodyTag.index + bodyTag[0].length,
  );
  return bodyEnd < 0 ? "" : tail.slice(0, bodyEnd + bodyTag[1].length);
}

describe("initial brief stale reservation recovery", () => {
  it("expires an abandoned server attempt before reserving a retry", () => {
    const expire = sqlFunction(
      "private",
      "expire_stale_initial_brief_reservations",
    );
    const reserve = sqlFunction("public", "reserve_initial_brief_ai_call");

    expect(expire).not.toBe("");
    expect(expire).toMatch(
      /\ba\.lifecycle_state\s+in\s*\(\s*'reserved'\s*,\s*'completed'\s*\)[\s\S]*?\ba\.created_at\s*<[\s\S]*?interval\s+'10 minutes'/i,
    );
    expect(expire).toMatch(/\bfor\s+update\s+of\s+a\s*,\s*s\s*,\s*w\b/i);
    expect(expire).toMatch(
      /\bupdate\s+public\.ai_calls\b[\s\S]*?\blifecycle_state\s*=\s*'abandoned'/i,
    );
    expect(expire).toMatch(
      /\bwhere\s+id\s*=\s*v_stale\.ai_call_id[\s\S]{0,120}?\blifecycle_state\s*=\s*'reserved'/i,
    );
    expect(expire).toMatch(
      /\bupdate\s+public\.workflow_step_runs\b[\s\S]*?\bstatus\s*=\s*'failed'/i,
    );
    expect(expire).toMatch(
      /\bupdate\s+public\.workflow_runs\b[\s\S]*?\bstatus\s*=\s*'failed'/i,
    );
    expect(expire).toMatch(/'initial_brief_reservation_expired'/i);
    expect(expire).toMatch(
      /'ai_lifecycle_state'\s*,\s*v_stale\.ai_lifecycle_state/i,
    );

    const expiryCall = reserve.search(
      /private\.expire_stale_initial_brief_reservations\s*\(/i,
    );
    const activeConflict = reserve.search(
      /if\s+exists\s*\([\s\S]*?from\s+public\.ai_calls[\s\S]*?lifecycle_state\s*=\s*'reserved'/i,
    );
    expect(expiryCall).toBeGreaterThanOrEqual(0);
    expect(activeConflict).toBeGreaterThan(expiryCall);
    expect(reserve).toMatch(
      /\bretry_of_id\b[\s\S]{0,700}?\bv_retry_of_id\b/i,
    );
  });
});
