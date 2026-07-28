import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const stripSqlComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .replace(/--[^\n\r]*/g, (comment) => " ".repeat(comment.length));

const functionContaining = (sql: string, needle: string): string => {
  const starts = [...sql.matchAll(/\bcreate\s+(?:or\s+replace\s+)?function\s+/gi)].map(
    (match) => match.index,
  );

  for (const [index, start] of starts.entries()) {
    const end = starts[index + 1] ?? sql.length;
    const candidate = sql.slice(start, end);
    if (candidate.toLowerCase().includes(needle.toLowerCase())) return candidate;
  }

  throw new Error(`No SQL function contains ${needle}`);
};

const functionName = (sqlFunction: string): { qualified: string; base: string } => {
  const match = sqlFunction.match(
    /create\s+(?:or\s+replace\s+)?function\s+((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)/i,
  );
  const qualified = match?.[1];
  if (!qualified) throw new Error("Unable to determine SQL function name");

  return {
    qualified,
    base: qualified.split(".").at(-1)!.replaceAll('"', ""),
  };
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("governed M1 runtime persistence", () => {
  it("persists canonical draft attempts through the guarded application RPC and records issuance idempotently from a trigger", () => {
    const migrationSource = stripSqlComments(
      readFileSync(
        resolve(
          process.cwd(),
          "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
        ),
        "utf8",
      ),
    );
    const proposalPageSource = readFileSync(
      resolve(process.cwd(), "app/dashboard/projects/[id]/proposal/page.tsx"),
      "utf8",
    );

    const draftSteps = [
      "generate_clarifying_questions",
      "build_scope_draft",
      "calculate_fee",
      "generate_proposal_draft",
    ] as const;
    const draftRpc = functionContaining(
      migrationSource,
      "persist_m1_proposal_draft_steps",
    );
    const draftRpcName = functionName(draftRpc);
    const atomicDraftRpc = functionContaining(
      migrationSource,
      "get_or_create_m1_proposal_draft",
    );
    const atomicDraftRpcName = functionName(atomicDraftRpc);
    const stepPositions = draftSteps.map((step) => draftRpc.indexOf(`'${step}'`));

    expect(stepPositions.every((position) => position >= 0)).toBe(true);
    expect(stepPositions).toEqual([...stepPositions].sort((left, right) => left - right));
    expect(draftRpc).toMatch(/\binsert\s+into\s+public\.workflow_step_runs\b/i);
    expect(draftRpc).toMatch(
      /\binsert\s+into\s+public\.workflow_step_runs\s*\([\s\S]*?\battempt\b[\s\S]*?\)/i,
    );
    expect(draftRpc).toMatch(/(?:status|outcome)[\s\S]{0,160}'completed'|'completed'[\s\S]{0,160}(?:status|outcome)/i);
    expect(draftRpc).toMatch(/\bon\s+conflict\b[\s\S]{0,200}\bdo\s+(?:nothing|update)\b/i);
    expect(draftRpc).toMatch(/\bsecurity\s+definer\b/i);
    expect(draftRpc).toMatch(/\bauth\.uid\s*\(\s*\)/i);
    expect(draftRpc).toMatch(/\bproject_id\b/i);
    expect(draftRpc).toMatch(/\b(?:membership|member|role|designer_id)\b/i);
    expect(draftRpc).toMatch(/\b(?:raise\s+(?:exception|sqlstate)|[a-z0-9_]*(?:guard|authoriz|access)[a-z0-9_]*\s*\()/i);
    expect(draftRpc).toMatch(
      /\bcurrent_step\s*=\s*'issue_proposal'[\s\S]*?'proposal_release_invalidated_by_redraft'/i,
    );

    const rpcAclName = `${escapeRegExp(draftRpcName.qualified)}\\s*\\([^;]*\\)`;
    expect(migrationSource).toMatch(
      new RegExp(
        `revoke\\s+(?:all|execute)\\s+on\\s+function\\s+${rpcAclName}\\s+from\\s+(?:public|anon)`,
        "i",
      ),
    );
    expect(migrationSource).toMatch(
      new RegExp(
        `grant\\s+execute\\s+on\\s+function\\s+${rpcAclName}\\s+to\\s+authenticated`,
        "i",
      ),
    );
    expect(atomicDraftRpc).toMatch(
      new RegExp(
        `${escapeRegExp(draftRpcName.qualified)}\\s*\\(`,
        "i",
      ),
    );
    expect(proposalPageSource).toMatch(
      new RegExp(
        `\\.rpc\\s*\\(\\s*["']${escapeRegExp(atomicDraftRpcName.base)}["']`,
        "i",
      ),
    );
    expect(proposalPageSource).not.toMatch(/service[_-]?role|SUPABASE_SERVICE_ROLE_KEY/i);

    const issueFunction = functionContaining(
      migrationSource,
      "record_m1_proposal_issuance",
    );
    const issueFunctionName = functionName(issueFunction);
    expect(issueFunction).toMatch(/'issue_proposal'/i);
    expect(issueFunction).toMatch(/\binsert\s+into\s+public\.workflow_step_runs\b/i);
    expect(issueFunction).toMatch(
      /\binsert\s+into\s+public\.workflow_step_runs\s*\([\s\S]*?\battempt\b[\s\S]*?\)/i,
    );
    expect(issueFunction).toMatch(/(?:status|outcome)[\s\S]{0,160}'completed'|'completed'[\s\S]{0,160}(?:status|outcome)/i);
    expect(issueFunction).toMatch(/\bon\s+conflict\b[\s\S]{0,200}\bdo\s+(?:nothing|update)\b/i);

    const issueTrigger = (
      migrationSource.match(/\bcreate\s+(?:constraint\s+)?trigger\b[\s\S]*?;/gi) ?? []
    ).find((statement) =>
      statement.toLowerCase().includes(issueFunctionName.base.toLowerCase()),
    );
    expect(issueTrigger).toBeDefined();
    expect(issueTrigger!).toMatch(/\bafter\s+update\b/i);
    expect(issueTrigger!).toMatch(
      /\bon\s+(?:"?[a-z_][a-z0-9_]*"?\.)?"?proposal[a-z0-9_]*"?/i,
    );
    expect(`${issueFunction}\n${issueTrigger}`).toMatch(/\bnew\.(?:status|sent_at|issued_at)\b/i);
    expect(`${issueFunction}\n${issueTrigger}`).toMatch(/\bold\.(?:status|sent_at|issued_at)\b/i);
    expect(`${issueFunction}\n${issueTrigger}`).toMatch(/'sent'|sent_at|issued_at/i);
    expect(proposalPageSource).toMatch(
      /proposalWorkflow\.status\s*===\s*["']running["'][\s\S]{0,160}?proposalWorkflow\.current_step\s*===\s*["']issue_proposal["']/i,
    );
  });
});
