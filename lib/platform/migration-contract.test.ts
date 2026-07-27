import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const foundationSql = readFileSync(
  join(process.cwd(), "supabase/migrations/0007_platform_foundation_m1.sql"),
  "utf8",
);
const hardeningSql = readFileSync(
  join(process.cwd(), "supabase/migrations/0008_platform_security_hardening.sql"),
  "utf8",
);

describe("platform migration security contract", () => {
  it("is additive and enables RLS on every new project table", () => {
    expect(foundationSql).not.toMatch(/\bdrop\s+table\b|\bdrop\s+column\b/i);
    expect(hardeningSql).not.toMatch(/\bdrop\s+table\b|\bdrop\s+column\b/i);
    for (const table of [
      "project_sources", "project_facts", "workflow_runs", "workflow_step_runs",
      "approval_requests", "audit_events", "ai_calls", "studio_standards", "project_overrides",
    ]) {
      expect(foundationSql).toContain(`alter table public.${table} enable row level security`);
    }
  });
  it("prevents AI confirmation and keeps audit/cost ledgers append-only", () => {
    expect(foundationSql).toContain("created_by_type <> 'ai' or status <> 'human_confirmed'");
    expect(hardeningSql).toMatch(/revoke all on table[\s\S]+public\.ai_calls[\s\S]+from anon, authenticated/i);
    expect(hardeningSql).toContain("grant select on table");
  });
  it("has no anonymous policy for facts, workflows, approvals or AI calls", () => {
    expect(foundationSql).not.toMatch(/create policy[\s\S]{0,180}\bto anon\b/i);
    expect(hardeningSql).not.toMatch(/create policy[\s\S]{0,180}\bto anon\b/i);
  });
  it("keeps the membership helper private and enforces governed mutations", () => {
    expect(hardeningSql).toContain("create schema if not exists private");
    expect(hardeningSql).toContain("set search_path = ''");
    expect(hardeningSql).toContain("approval request identity is immutable");
    expect(hardeningSql).toContain("invalid workflow transition");
  });
});
