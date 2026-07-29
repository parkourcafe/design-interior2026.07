import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
);

const stripSqlComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const extractFunctionDefinition = (
  sql: string,
  functionName: string,
): string | null => {
  const header = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?function\\s+${escapeRegExp(functionName)}\\s*\\(`,
    "i",
  ).exec(sql);

  if (!header) return null;

  const tail = sql.slice(header.index);
  const bodyMarker = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  const delimiter = bodyMarker?.[1];
  if (!delimiter) return null;

  const bodyStart = bodyMarker.index + bodyMarker[0].length;
  const bodyEnd = tail.indexOf(delimiter, bodyStart);
  if (bodyEnd < 0) return null;

  const statementEnd = tail.indexOf(";", bodyEnd + delimiter.length);
  return statementEnd < 0 ? null : tail.slice(0, statementEnd + 1);
};

const extractTriggerFunction = (
  sql: string,
  timing: "before" | "after",
): string | null => {
  const trigger = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?trigger\\s+[a-z_][a-z0-9_$]*\\s+${timing}\\s+insert\\s+on\\s+(?:public\\.)?studio_standards\\b[^;]*?\\bexecute\\s+(?:function|procedure)\\s+([a-z_][a-z0-9_$]*(?:\\.[a-z_][a-z0-9_$]*)?)\\s*\\(`,
    "i",
  ).exec(sql);

  return trigger?.[1] ?? null;
};

describe("studio standard immutable version-chain migration contract", () => {
  it("guards every insert with a locked, linear predecessor chain", () => {
    const sql = stripSqlComments(readFileSync(migrationPath, "utf8")).replace(
      /"/g,
      "",
    );

    const guardFunctionName = extractTriggerFunction(sql, "before");
    expect(
      guardFunctionName,
      "studio_standards needs a BEFORE INSERT version-chain guard",
    ).not.toBeNull();

    const guardSql = guardFunctionName
      ? extractFunctionDefinition(sql, guardFunctionName)
      : null;
    expect(
      guardSql,
      "the BEFORE INSERT version-chain guard must be defined in this migration",
    ).not.toBeNull();

    const definition = guardSql!;
    expect(definition).toMatch(/\breturns\s+trigger\b/i);
    expect(definition).toMatch(/\bsecurity\s+definer\b/i);
    expect(definition).toMatch(/\bset\s+search_path\s*(?:=|to)\s*''/i);

    expect(
      definition,
      "the first standard must have no predecessor and must use version 1",
    ).toMatch(
      /\bif\s+new\.supersedes_id\s+is\s+null\s+then\b[\s\S]*?\bif\s+new\.version\s*(?:<>|!=)\s*1\s+then\b[\s\S]*?\braise\s+exception\b/i,
    );

    expect(
      definition,
      "later versions must load their exact predecessor",
    ).toMatch(
      /\bselect\b[\s\S]*?\binto\b[\s\S]*?\bfrom\s+(?:public\.)?studio_standards\b[\s\S]*?\bwhere\b[\s\S]*?\bid\s*=\s*new\.supersedes_id\b/i,
    );
    expect(
      definition,
      "the predecessor row must be locked before validating the successor",
    ).toMatch(/\bfor\s+(?:no\s+key\s+)?update\b/i);

    expect(definition).toMatch(/\bnew\.studio_id\b/i);
    expect(definition).toMatch(
      /\b[a-z_][a-z0-9_$]*\.studio_id\s+is\s+distinct\s+from\s+new\.studio_id\b|\bnew\.studio_id\s+is\s+distinct\s+from\s+[a-z_][a-z0-9_$]*\.studio_id\b/i,
    );
    expect(definition).toMatch(/\bnew\.standard_key\b/i);
    expect(definition).toMatch(
      /\b[a-z_][a-z0-9_$]*\.standard_key\s+is\s+distinct\s+from\s+new\.standard_key\b|\bnew\.standard_key\s+is\s+distinct\s+from\s+[a-z_][a-z0-9_$]*\.standard_key\b/i,
    );
    expect(
      definition,
      "a successor version must be exactly predecessor.version + 1",
    ).toMatch(
      /\bnew\.version\s*(?:<>|!=)\s*[a-z_][a-z0-9_$]*\.version\s*\+\s*1\b/i,
    );

    expect(
      sql,
      "a unique partial index must prevent concurrent successors from branching the chain",
    ).toMatch(
      /\bcreate\s+unique\s+index\b[\s\S]*?\bon\s+(?:public\.)?studio_standards\s*\(\s*supersedes_id\s*\)[\s\S]*?\bwhere\s+supersedes_id\s+is\s+not\s+null\b/i,
    );
  });

  it("records the standard key and both version identities in standard_drift", () => {
    const sql = stripSqlComments(readFileSync(migrationPath, "utf8")).replace(
      /"/g,
      "",
    );
    const driftFunctionName = extractTriggerFunction(sql, "after");
    expect(
      driftFunctionName,
      "studio_standards needs its standard_drift AFTER INSERT trigger",
    ).not.toBeNull();

    const driftSql = driftFunctionName
      ? extractFunctionDefinition(sql, driftFunctionName)
      : null;
    expect(
      driftSql,
      "the standard_drift trigger function must be defined in this migration",
    ).not.toBeNull();

    const definition = driftSql!;
    expect(definition).toMatch(/'standard_drift'/i);
    expect(definition).toMatch(/'standard_key'\s*,\s*new\.standard_key/i);
    expect(definition).toMatch(
      /'old_standard_version_id'\s*,\s*[a-z_][a-z0-9_$]*\.id/i,
    );
    expect(definition).toMatch(/'new_standard_version_id'\s*,\s*new\.id/i);
    expect(definition).toMatch(
      /'old_standard_version'\s*,\s*[a-z_][a-z0-9_$]*\.version/i,
    );
    expect(definition).toMatch(
      /'new_standard_version'\s*,\s*new\.version/i,
    );
    expect(
      definition,
      "the old identity and version must come from the exact persisted standard pinned by the approved project override",
    ).toMatch(
      /\bjoin\s+(?:public\.)?studio_standards\s+([a-z_][a-z0-9_$]*)\s+on\s+\1\.id\s*=\s*(?:[a-z_][a-z0-9_$]*\.)?standard_version_id\b/i,
    );
  });
});
