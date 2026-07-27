import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727213000_reserve_m1_risk_ai_call.sql",
  ),
  "utf8",
);

function functionBody(name: string): string {
  const match = sql.match(
    new RegExp(
      String.raw`create or replace function public\.${name}\b([\s\S]*?)\$\$;`,
      "i",
    ),
  );
  if (!match?.[0]) throw new Error(`Missing SQL function ${name}`);
  return match[0];
}

describe("M1 risk AI reservation migration contract", () => {
  it.each(["reserve_m1_risk_rerun", "reserve_m1_risk_retry"])(
    "%s authenticates, serializes, and reserves step plus ledger before AI",
    (name) => {
      const command = functionBody(name);
      const stepInsert = command.indexOf(
        "insert into public.workflow_step_runs",
      );
      const callInsert = command.indexOf("insert into public.ai_calls");

      expect(command).toContain("security definer");
      expect(command).toContain("set search_path = ''");
      expect(command).toContain("auth.uid() is null");
      expect(command).toContain("private.is_studio_member");
      expect(command).toMatch(/for update of w/i);
      expect(stepInsert).toBeGreaterThan(-1);
      expect(callInsert).toBeGreaterThan(stepInsert);
      expect(command).toContain("'generate_risk_register'");
      expect(command).toContain("'metered_ai'");
      expect(command).toContain("'reserved', 'reserved'");
      expect(sql).toMatch(
        new RegExp(
          String.raw`revoke all on function public\.${name}[\s\S]*?from public, anon, authenticated`,
          "i",
        ),
      );
      expect(sql).toMatch(
        new RegExp(
          String.raw`grant execute on function public\.${name}[\s\S]*?to authenticated`,
          "i",
        ),
      );
    },
  );

  it("distinguishes unfinished reservations from successful calls", () => {
    expect(sql).toContain(
      "lifecycle_state in ('reserved', 'completed', 'abandoned')",
    );
    expect(sql).toContain(
      "outcome in ('reserved', 'success', 'schema_fail', 'provider_error', 'timeout', 'abandoned')",
    );
  });
});
