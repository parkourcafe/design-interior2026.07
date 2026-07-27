import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727220000_finalize_m1_risk_ai_call.sql",
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

describe("M1 risk AI terminal commands", () => {
  it("finalizes the exact reservation and business output in one transaction", () => {
    const command = functionBody("finalize_m1_risk_rerun");

    expect(command).toContain("security definer");
    expect(command).toContain("set search_path = ''");
    expect(command).toContain("private.is_studio_member");
    expect(command).toMatch(
      /from public\.workflow_step_runs[\s\S]*?s\.id = p_workflow_step_run_id[\s\S]*?for update of s/i,
    );
    expect(command).toMatch(
      /from public\.ai_calls[\s\S]*?a\.id = p_ai_call_id[\s\S]*?a\.lifecycle_state = 'completed'[\s\S]*?for update/i,
    );
    expect(command).not.toContain("update public.ai_calls");
    expect(command).not.toContain("insert into public.ai_calls");
    expect(command).toContain("update public.projects");
    expect(command).toContain("delete from public.risk_cards");
    expect(command).toContain("insert into public.risk_cards");
    expect(command).toContain("update public.workflow_step_runs");
    expect(command).toContain("insert into public.audit_events");
    expect(command).not.toMatch(/exception\s+when/i);
  });

  it("persists exact provider usage before business-state finalization", () => {
    const command = functionBody("record_m1_risk_ai_usage");

    expect(command).toContain("a.id = p_ai_call_id");
    expect(command).toContain(
      "a.workflow_step_run_id = p_workflow_step_run_id",
    );
    expect(command).toContain("private.is_studio_member");
    expect(command).toContain("for update of a");
    expect(command).toContain("update public.ai_calls");
    expect(command).toContain("lifecycle_state = 'completed'");
    expect(command).toContain("completed AI usage is immutable");
  });

  it("closes stranded reservations with measured or abandoned terminal state", () => {
    const command = functionBody("close_m1_risk_ai_reservation");

    expect(command).toContain("p_provider_completed boolean");
    expect(command).toContain("lifecycle_state = 'completed'");
    expect(command).toContain("lifecycle_state = 'abandoned'");
    expect(command).toContain("status = 'failed'");
    expect(command).toContain("'risk_ai_reservation_closed'");
    expect(sql).toMatch(
      /revoke all on function public\.close_m1_risk_ai_reservation[\s\S]*?from public, anon, authenticated/i,
    );
    expect(sql).toMatch(
      /grant execute on function public\.close_m1_risk_ai_reservation[\s\S]*?to authenticated/i,
    );
  });
});
