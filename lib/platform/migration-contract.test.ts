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
const retrySql = readFileSync(
  join(process.cwd(), "supabase/migrations/0009_workflow_retry_idempotency.sql"),
  "utf8",
);
const correctiveSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727111743_govern_proposal_revisions_and_workflow_commands.sql",
  ),
  "utf8",
);
const issuedLockSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727113109_lock_issued_proposal_content.sql",
  ),
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
  it("prevents concurrent duplicate active step attempts", () => {
    expect(retrySql).toContain("workflow_step_runs_one_active_attempt_idx");
    expect(retrySql).toContain("where status in ('queued', 'running', 'waiting_for_human', 'pending_cost_confirmation')");
  });
});

describe("corrective workflow and proposal revision contract", () => {
  it("ships as a new additive migration after 0009", () => {
    expect(correctiveSql).not.toMatch(/\bdrop\s+(?:table|column)\b/i);
  });

  it("makes workflow ledgers and approval requests read-only to authenticated clients", () => {
    for (const table of [
      "workflow_runs",
      "workflow_step_runs",
      "approval_requests",
    ]) {
      expect(correctiveSql).toMatch(
        new RegExp(
          `revoke\\s+(?:all|insert\\s*,\\s*update\\s*,\\s*delete)[\\s\\S]{0,180}on\\s+(?:table\\s+)?public\\.${table}[\\s\\S]{0,100}from\\s+authenticated`,
          "i",
        ),
      );
      expect(correctiveSql).toMatch(
        new RegExp(
          `grant\\s+select\\s+on\\s+(?:table\\s+)?public\\.${table}\\s+to\\s+authenticated`,
          "i",
        ),
      );
    }
  });

  it("exposes only guarded authenticated commands for workflow and proposal mutations", () => {
    const commands = [
      "prepare_m1_risk_retry",
      "complete_m1_risk_retry",
      "fail_m1_risk_retry",
      "record_m1_risk_rerun",
      "authorize_proposal_revision",
      "issue_proposal_revision",
    ];

    for (const command of commands) {
      expect(correctiveSql).toMatch(
        new RegExp(
          `create\\s+or\\s+replace\\s+function\\s+public\\.${command}\\b[\\s\\S]*?security\\s+definer[\\s\\S]*?set\\s+search_path\\s*=\\s*''`,
          "i",
        ),
      );
      expect(correctiveSql).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+public\\.${command}\\([^;]*\\)\\s+from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated`,
          "i",
        ),
      );
      expect(correctiveSql).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${command}\\([^;]*\\)\\s+to\\s+authenticated`,
          "i",
        ),
      );
    }

    expect(correctiveSql.match(/auth\.uid\(\)\s+is\s+null/gi)?.length).toBeGreaterThanOrEqual(
      commands.length,
    );
  });

  it("stores immutable proposal revisions and binds proposal approvals to one revision", () => {
    expect(correctiveSql).toMatch(
      /create\s+table(?:\s+if\s+not\s+exists)?\s+public\.proposal_revisions\b/i,
    );
    expect(correctiveSql).toMatch(
      /revoke\s+(?:all|insert\s*,\s*update\s*,\s*delete)[\s\S]{0,180}on\s+(?:table\s+)?public\.proposal_revisions[\s\S]{0,100}from\s+authenticated/i,
    );
    expect(correctiveSql).toMatch(
      /grant\s+select\s+on\s+(?:table\s+)?public\.proposal_revisions\s+to\s+authenticated/i,
    );
    expect(correctiveSql).toMatch(
      /proposal_revision_id\s+uuid[\s\S]{0,160}references\s+public\.proposal_revisions\s*\(\s*id\s*\)/i,
    );
    expect(correctiveSql).toMatch(
      /subject_type\s*=\s*'proposal'[\s\S]{0,240}proposal_revision_id\s+is\s+not\s+null|proposal_revision_id\s+is\s+not\s+null[\s\S]{0,240}subject_type\s*=\s*'proposal'/i,
    );
  });

  it("prevents issued proposal content from being changed in place", () => {
    expect(issuedLockSql).toContain("issued proposal content is immutable");
    expect(issuedLockSql).toMatch(
      /before\s+update\s+on\s+public\.proposals[\s\S]+execute\s+function\s+private\.enforce_issued_proposal_immutability/i,
    );
    expect(issuedLockSql).toMatch(
      /old\.status\s*=\s*'sent'[\s\S]+new\.sections\s+is\s+distinct\s+from\s+old\.sections/i,
    );
  });
});
