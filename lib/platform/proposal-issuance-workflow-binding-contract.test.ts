import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const completionSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
  ),
  "utf8",
);
const canonicalIssuanceSql = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260727114500_guard_proposal_revision_issuance.sql",
  ),
  "utf8",
);

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractFunctionDefinition = (
  sql: string,
  functionName: string,
): string => {
  const header = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${escapeRegExp(functionName)}\\s*\\(`,
    "i",
  ).exec(sql);

  expect(header, `${functionName} must be defined`).not.toBeNull();
  if (!header) throw new Error(`${functionName} is missing`);

  const tail = sql.slice(header.index);
  const bodyMarker = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  const delimiter = bodyMarker?.[1];
  expect(delimiter, `${functionName} must use a dollar-quoted body`).toBeTruthy();
  if (!bodyMarker || !delimiter) throw new Error(`${functionName} body is missing`);

  const bodyStart = bodyMarker.index + bodyMarker[0].length;
  const bodyEnd = tail.indexOf(delimiter, bodyStart);
  expect(bodyEnd, `${functionName} body must be closed`).toBeGreaterThan(bodyStart);

  return tail.slice(0, bodyEnd + delimiter.length);
};

const observer = extractFunctionDefinition(
  completionSql,
  "private.record_m1_proposal_issuance",
);
const canonicalIssueCommand = extractFunctionDefinition(
  canonicalIssuanceSql,
  "public.issue_proposal_revision",
);

describe("proposal issuance workflow binding contract", () => {
  it("binds the issue step to the approved request for the exact issued revision", () => {
    expect(observer).toMatch(
      /\bfrom\s+public\.approval_requests\s+(?:as\s+)?[a-z_][a-z0-9_$]*/i,
    );
    expect(observer).toMatch(
      /\bproposal_revision_id\s*=\s*new\.issued_revision_id\b/i,
    );
    expect(observer).toMatch(/\bsubject_id\s*=\s*new\.id\b/i);
    expect(observer).toMatch(/\bsubject_type\s*=\s*'proposal'/i);
    expect(observer).toMatch(/\bapproval_type\s*=\s*'RELEASE_AUTHORIZED'/i);
    expect(observer).toMatch(/\bstatus\s*=\s*'approved'/i);
    expect(observer).toMatch(
      /\bv_workflow_run_id\s*(?::=|=)\s*[a-z_][a-z0-9_$]*\.workflow_run_id\b/i,
    );

    expect(
      observer,
      "issuance must never select a newest workflow run merely by project",
    ).not.toMatch(
      /\bfrom\s+public\.workflow_runs\b[\s\S]*?\bproject_id\s*=\s*new\.project_id\b[\s\S]*?\border\s+by\b[\s\S]*?\blimit\s+1\b/i,
    );
  });

  it("records all three immutable issuance identities in the completed step snapshot", () => {
    expect(observer.match(/'proposal_id'/gi)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(observer.match(/'issued_revision_id'/gi)?.length ?? 0).toBeGreaterThanOrEqual(
      1,
    );
    expect(observer.match(/'approval_request_id'/gi)?.length ?? 0).toBeGreaterThanOrEqual(
      1,
    );
    expect(observer).toMatch(/\bnew\.id\b/i);
    expect(observer).toMatch(/\bnew\.issued_revision_id\b/i);
    expect(observer).toMatch(/\bv_approval_request_id\b/i);
  });

  it("replays idempotently only for the same proposal, revision, and approval identity", () => {
    const idempotencyGuard =
      /\bif\s+(?:not\s+)?exists\s*\(([\s\S]*?)\)\s+then\b/i.exec(observer)?.[1];

    expect(
      idempotencyGuard,
      "observer must check an existing completed issue_proposal step before inserting",
    ).toBeTruthy();
    if (!idempotencyGuard) throw new Error("issuance identity guard is missing");

    expect(idempotencyGuard).toMatch(/\bfrom\s+public\.workflow_step_runs\b/i);
    expect(idempotencyGuard).toMatch(/\bstep_key\s*=\s*'issue_proposal'/i);
    expect(idempotencyGuard).toMatch(/\bstatus\s*=\s*'completed'/i);
    expect(idempotencyGuard).toMatch(/'proposal_id'/i);
    expect(idempotencyGuard).toMatch(/'issued_revision_id'/i);
    expect(idempotencyGuard).toMatch(/'approval_request_id'/i);
    expect(idempotencyGuard).toMatch(/\bnew\.id\b/i);
    expect(idempotencyGuard).toMatch(/\bnew\.issued_revision_id\b/i);
    expect(idempotencyGuard).toMatch(/\bv_approval_request_id\b/i);
  });

  it("leaves the authoritative proposal_issued audit event to the issue command", () => {
    expect(canonicalIssueCommand).toMatch(
      /\binsert\s+into\s+public\.audit_events\b[\s\S]*?'proposal_issued'/i,
    );
    expect(observer).not.toMatch(/'proposal_issued'/i);
  });
});
