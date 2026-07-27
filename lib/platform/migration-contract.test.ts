import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase/migrations/0007_platform_foundation_m1.sql"),
  "utf8",
);

describe("platform migration security contract", () => {
  it("is additive and enables RLS on every new project table", () => {
    expect(sql).not.toMatch(/\bdrop\s+table\b|\bdrop\s+column\b/i);
    for (const table of [
      "project_sources", "project_facts", "workflow_runs", "workflow_step_runs",
      "approval_requests", "audit_events", "ai_calls", "studio_standards", "project_overrides",
    ]) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
  });
  it("prevents AI confirmation and keeps audit/cost ledgers append-only", () => {
    expect(sql).toContain("created_by_type <> 'ai' or status <> 'human_confirmed'");
    expect(sql).toContain("revoke update, delete on public.ai_calls from authenticated");
    expect(sql).toContain("revoke update, delete on public.audit_events from authenticated");
  });
  it("has no anonymous policy for facts, workflows, approvals or AI calls", () => {
    expect(sql).not.toMatch(/create policy[\s\S]{0,180}\bto anon\b/i);
  });
});
