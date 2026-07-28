import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

function exportedApiSlice(source: string, apiName: string): string {
  const start = source.search(
    new RegExp(`export\\s+(?:async\\s+)?(?:function|const)\\s+${apiName}\\b`),
  );

  if (start < 0) {
    throw new Error(`${apiName} must be exported`);
  }

  const tail = source.slice(start);
  const nextExportOffset = tail
    .slice(1)
    .search(/\n\s*export\s+(?:async\s+)?(?:function|const)\s+\w+/);

  return nextExportOffset < 0
    ? tail
    : tail.slice(0, nextExportOffset + 1);
}

function sqlFunctionSlice(sql: string, functionName: string): string {
  const start = sql.search(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+(?:"?[a-z_][a-z0-9_$]*"?\\s*\\.\\s*)?"?${functionName}"?\\b`,
      "i",
    ),
  );

  if (start < 0) {
    throw new Error(`${functionName} RPC must be created by the additive migration`);
  }

  const tail = sql.slice(start);
  const delimiterMatch = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!delimiterMatch?.[1] || delimiterMatch.index === undefined) {
    throw new Error(`${functionName} must have a dollar-quoted function body`);
  }

  const delimiter = delimiterMatch[1];
  const bodyStart = delimiterMatch.index + delimiterMatch[0].length;
  const bodyEnd = tail.indexOf(delimiter, bodyStart);
  if (bodyEnd < 0) {
    throw new Error(`${functionName} has no closing function delimiter`);
  }

  return tail.slice(0, bodyEnd + delimiter.length);
}

function withoutSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--.*$/gm, "");
}

describe("initial intake AI metering contract", () => {
  it("reserves the workflow step run and AI call before provider execution, records usage before finalization, and exposes the reservation RPC only to service_role", () => {
    const routeSource = readSource("app/api/intake/submit/route.ts");
    const adapterSource = readSource("lib/platform/m1-workflow.ts");
    const migrationSource = withoutSqlComments(
      readSource(
        "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
      ),
    );

    const orderedRouteCalls = [
      /await\s+reserveInitialBriefAiCall\s*\(/,
      /await\s+runRiskPipeline\s*\(/,
      /await\s+recordInitialBriefAiUsage\s*\(/,
      /await\s+finalizeInitialBrief\s*\(/,
    ].map((pattern) => routeSource.search(pattern));

    expect(orderedRouteCalls.every((position) => position >= 0)).toBe(true);
    expect(orderedRouteCalls).toEqual(
      [...orderedRouteCalls].sort((left, right) => left - right),
    );

    const reserveAdapter = exportedApiSlice(
      adapterSource,
      "reserveInitialBriefAiCall",
    );
    const usageAdapter = exportedApiSlice(
      adapterSource,
      "recordInitialBriefAiUsage",
    );
    const finalizerAdapter = exportedApiSlice(adapterSource, "finalizeInitialBrief");

    expect(reserveAdapter).toMatch(
      /\.rpc\s*\(\s*["'`]reserve_initial_brief_ai_call["'`]/,
    );
    expect(usageAdapter).toMatch(/\b(?:aiCallId|ai_call_id)\b/);
    expect(usageAdapter).toMatch(/\.(?:update|rpc)\s*\(/);
    expect(finalizerAdapter).toMatch(
      /\b(?:reservedWorkflowStepRunId|workflowStepRunId|workflow_step_run_id)\b/,
    );
    expect(finalizerAdapter).toMatch(
      /\b(?:reservedAiCallId|aiCallId|ai_call_id)\b/,
    );
    expect(adapterSource).not.toMatch(
      /\.from\s*\(\s*["'`]ai_calls["'`]\s*\)[\s\S]{0,240}?\.insert\s*\(/,
    );

    const reservationFunction = sqlFunctionSlice(
      migrationSource,
      "reserve_initial_brief_ai_call",
    );

    expect(reservationFunction).toMatch(/\bsecurity\s+definer\b/i);
    expect(reservationFunction).toMatch(
      /(?:auth\s*\.\s*(?:role|jwt)\s*\(|current_setting\s*\()/i,
    );
    expect(reservationFunction).toMatch(/\bservice_role\b/i);
    expect(reservationFunction).toMatch(/\bgenerate_risk_register\b/i);
    expect(reservationFunction).toMatch(
      /insert\s+into\s+(?:"?public"?\s*\.\s*)?"?workflow_step_runs"?\b/i,
    );
    expect(reservationFunction).toMatch(
      /insert\s+into\s+(?:"?[a-z_][a-z0-9_$]*"?\s*\.\s*)?"?ai_calls"?\b/i,
    );
    expect(reservationFunction).toMatch(/\bworkflow_step_run_id\b/i);
    expect(reservationFunction).toMatch(/\bai_call_id\b/i);

    const reservationAcl = migrationSource
      .split(";")
      .map((statement) => statement.replace(/\s+/g, " ").trim())
      .filter(
        (statement) =>
          /reserve_initial_brief_ai_call/i.test(statement) &&
          /^(?:grant|revoke)\b/i.test(statement),
      );
    const isRevokedFrom = (role: string): boolean =>
      reservationAcl.some(
        (statement) =>
          /^revoke\s+(?:all(?:\s+privileges)?|execute)\b/i.test(statement) &&
          new RegExp(`\\bfrom\\b[\\s\\S]*\\b${role}\\b`, "i").test(statement),
      );

    expect(isRevokedFrom("public")).toBe(true);
    expect(isRevokedFrom("anon")).toBe(true);
    expect(isRevokedFrom("authenticated")).toBe(true);
    expect(
      reservationAcl.some(
        (statement) =>
          /^grant\s+execute\b/i.test(statement) &&
          /\bto\b[\s\S]*\bservice_role\b/i.test(statement),
      ),
    ).toBe(true);
    expect(
      reservationAcl.filter(
        (statement) =>
          /^grant\s+execute\b/i.test(statement) &&
          /\bto\b[\s\S]*\b(?:anon|authenticated)\b/i.test(statement),
      ),
    ).toEqual([]);

    expect(
      migrationSource.match(
        /insert\s+into\s+(?:"?[a-z_][a-z0-9_$]*"?\s*\.\s*)?"?ai_calls"?\b/gi,
      ) ?? [],
    ).toHaveLength(1);
    expect(migrationSource).not.toMatch(
      /\b(?:drop\s+(?:table|function)|truncate\s+table)\b/i,
    );
  });
});
