import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const actionsSource = readFileSync(
  join(process.cwd(), "app/dashboard/projects/[id]/actions.ts"),
  "utf8",
);

function exportedFunctionSource(name: string, nextExport: string): string {
  const start = actionsSource.indexOf(`export async function ${name}`);
  const end = actionsSource.indexOf(`export async function ${nextExport}`, start);

  if (start < 0 || end < 0) {
    throw new Error(`Cannot isolate ${name} from dashboard project actions`);
  }

  return actionsSource.slice(start, end);
}

function expectMutationErrorChecked(
  source: string,
  table: string,
  operation: "update" | "delete" | "insert",
): { index: number; errorName: string } | null {
  const mutation = new RegExp(
    String.raw`const\s*\{[^}]*\berror\s*(?::\s*([A-Za-z_$][\w$]*))?[^}]*\}\s*=\s*await\s+[^;]*?\.from\(\s*["']${table}["']\s*\)[^;]*?\.${operation}\s*\(`,
    "m",
  ).exec(source);
  const label = `${table}.${operation}`;

  expect.soft(
    mutation,
    `${label} must capture the database error instead of discarding the mutation result`,
  ).not.toBeNull();
  if (!mutation) return null;

  const errorName = mutation[1] ?? "error";
  const success = source.indexOf("return { ok: true", mutation.index);
  const afterMutation = source.slice(
    mutation.index + mutation[0].length,
    success < 0 ? source.length : success,
  );

  expect.soft(
    afterMutation,
    `${label} error must be checked before rerunRisks can report success`,
  ).toMatch(new RegExp(String.raw`\bif\s*\([^)]*\b${errorName}\b[^)]*\)`));

  return { index: mutation.index, errorName };
}

function mutationCallIndex(
  source: string,
  table: string,
  operation: "update" | "delete" | "insert",
): number {
  return source.search(
    new RegExp(
      String.raw`\.from\(\s*["']${table}["']\s*\)[^;]*?\.${operation}\s*\(`,
      "m",
    ),
  );
}

describe("rerunRisks governed AI accounting contract", () => {
  it("resolves the workflow before AI and checks every persistence error before success", () => {
    const source = exportedFunctionSource("rerunRisks", "reviewProjectFact");
    const pipelineIndex = source.indexOf("runRiskPipeline(");
    const workflowLookupIndex = source.search(
      /\.from\(\s*["']workflow_runs["']\s*\)/,
    );

    expect.soft(pipelineIndex, "rerunRisks must execute the risk pipeline").toBeGreaterThan(-1);
    expect.soft(
      workflowLookupIndex,
      "rerunRisks must resolve its governed M1 workflow run",
    ).toBeGreaterThan(-1);
    expect.soft(
      workflowLookupIndex,
      "the workflow run must be resolved before the metered AI pipeline executes",
    ).toBeLessThan(pipelineIndex);

    const beforePipeline = source.slice(0, pipelineIndex);
    const workflowResolution = new RegExp(
      String.raw`const\s*\{\s*data\s*:\s*([A-Za-z_$][\w$]*)\s*,\s*error\s*:\s*([A-Za-z_$][\w$]*)\s*\}\s*=\s*await\s+[^;]*?\.from\(\s*["']workflow_runs["']\s*\)[^;]*?;`,
      "m",
    ).exec(beforePipeline);

    expect.soft(
      workflowResolution,
      "workflow lookup must expose both data and error before AI execution",
    ).not.toBeNull();
    if (workflowResolution) {
      const [, runName, runErrorName] = workflowResolution;
      const afterResolution = beforePipeline.slice(
        (workflowResolution.index ?? 0) + workflowResolution[0].length,
      );
      expect.soft(
        afterResolution,
        "missing or failed workflow resolution must stop rerunRisks before AI execution",
      ).toMatch(
        new RegExp(
          String.raw`\bif\s*\([^)]*(?:\b${runErrorName}\b[^)]*!\s*${runName}|!\s*${runName}[^)]*\b${runErrorName}\b)[^)]*\)\s*(?:return|throw)`,
        ),
      );
    }

    expectMutationErrorChecked(source, "projects", "update");
    expectMutationErrorChecked(source, "risk_cards", "delete");
    expectMutationErrorChecked(source, "risk_cards", "insert");
    const aiCallMutation = expectMutationErrorChecked(source, "ai_calls", "insert");

    const businessMutationIndexes = [
      mutationCallIndex(source, "projects", "update"),
      mutationCallIndex(source, "risk_cards", "delete"),
      mutationCallIndex(source, "risk_cards", "insert"),
    ].filter((index) => index >= 0);
    const firstBusinessMutationIndex = Math.min(...businessMutationIndexes);

    expect.soft(
      businessMutationIndexes,
      "rerunRisks must persist its passport or risk-card business state",
    ).not.toHaveLength(0);
    if (aiCallMutation && Number.isFinite(firstBusinessMutationIndex)) {
      expect.soft(
        aiCallMutation.index,
        "the completed metered call must be persisted after the AI pipeline returns",
      ).toBeGreaterThan(pipelineIndex);
      expect.soft(
        aiCallMutation.index,
        "AI accounting must be persisted before passport or risk-card state changes",
      ).toBeLessThan(firstBusinessMutationIndex);

      const accountingBeforeBusinessMutation = source.slice(
        aiCallMutation.index,
        firstBusinessMutationIndex,
      );
      expect.soft(
        accountingBeforeBusinessMutation,
        "the ai_calls insert error must be checked before business state changes",
      ).toMatch(
        new RegExp(
          String.raw`\bif\s*\([^)]*\b${aiCallMutation.errorName}\b[^)]*\)`,
        ),
      );
    }
  });
});
