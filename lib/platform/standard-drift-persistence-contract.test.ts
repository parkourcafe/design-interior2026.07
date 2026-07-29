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

describe("standard drift persistence migration contract", () => {
  it("appends one immutable standard_drift audit event for every approved override pinned to any older standard in the lineage", () => {
    const migration = readFileSync(migrationPath, "utf8");
    const sql = stripSqlComments(migration).replace(/"/g, "");

    expect(sql).not.toMatch(/\bdrop\s+table\b/i);
    expect(sql).not.toMatch(/\bdrop\s+column\b/i);

    const trigger = /\bcreate\s+(?:or\s+replace\s+)?trigger\s+[a-z_][a-z0-9_$]*\s+after\s+insert\s+on\s+(?:public\.)?studio_standards\b[^;]*?\bexecute\s+(?:function|procedure)\s+([a-z_][a-z0-9_$]*(?:\.[a-z_][a-z0-9_$]*)?)\s*\(/i.exec(
      sql,
    );

    expect(trigger, "studio_standards must have an AFTER INSERT trigger").not.toBeNull();
    const triggerFunctionName = trigger?.[1];
    if (!triggerFunctionName) throw new Error("standard drift trigger function is missing");

    const functionSql = extractFunctionDefinition(sql, triggerFunctionName);
    expect(functionSql, "the trigger function must be defined by this migration").not.toBeNull();

    const definition = functionSql!;
    expect(definition).toMatch(/\breturns\s+trigger\b/i);
    expect(definition).toMatch(/\bsecurity\s+definer\b/i);
    expect(definition).toMatch(/\bset\s+search_path\s*(?:=|to)\s*''/i);
    expect(definition).toMatch(/\b(?:from|join)\s+(?:public\.)?project_overrides\b/i);
    expect(definition).toMatch(/\b(?:[a-z_][a-z0-9_$]*\.)?approved\s*(?:=\s*true|is\s+true)\b/i);
    expect(definition).toMatch(/\bnew\.supersedes_id\s+is\s+not\s+null\b/i);
    expect(definition).toMatch(
      /\bjoin\s+(?:public\.)?studio_standards\s+([a-z_][a-z0-9_$]*)\s+on\s+\1\.id\s*=\s*(?:[a-z_][a-z0-9_$]*\.)?standard_version_id\b/i,
    );
    expect(definition).toMatch(
      /\b[a-z_][a-z0-9_$]*\.studio_id\s*=\s*new\.studio_id\b/i,
    );
    expect(definition).toMatch(
      /\b[a-z_][a-z0-9_$]*\.standard_key\s*=\s*new\.standard_key\b/i,
    );
    expect(definition).toMatch(
      /\b[a-z_][a-z0-9_$]*\.version\s*<\s*new\.version\b/i,
    );
    expect(definition).not.toMatch(
      /(?:[a-z_][a-z0-9_$]*\.)?standard_version_id\s*=\s*new\.supersedes_id|new\.supersedes_id\s*=\s*(?:[a-z_][a-z0-9_$]*\.)?standard_version_id/i,
    );

    const auditInsert = /\binsert\s+into\s+(?:public\.)?audit_events\s*\(([^)]*)\)/i.exec(
      definition,
    );
    expect(auditInsert, "drift detection must append an audit_events row").not.toBeNull();
    const auditColumnList = auditInsert?.[1];
    if (!auditColumnList) throw new Error("standard drift audit column list is missing");

    const auditColumns = auditColumnList
      .split(",")
      .map((column) => column.trim().toLowerCase());
    expect(auditColumns).toEqual(
      expect.arrayContaining([
        "project_id",
        "actor_id",
        "actor_type",
        "event_type",
        "entity_type",
        "entity_id",
        "payload",
      ]),
    );
    expect(definition).toMatch(/'standard_drift'/i);
    expect(definition).toMatch(/'old_standard_version_id'/i);
    expect(definition).toMatch(/'new_standard_version_id'/i);
    expect(definition).toMatch(
      /'old_standard_version_id'\s*,\s*[a-z_][a-z0-9_$]*\.id\b/i,
    );
    expect(definition).toMatch(/\bnew\.id\b/i);
    expect(definition).toMatch(
      /'old_standard_version'\s*,\s*[a-z_][a-z0-9_$]*\.version\b/i,
    );
    expect(definition).toMatch(/'new_standard_version'\s*,\s*new\.version\b/i);
    expect(definition).toMatch(/\b[a-z_][a-z0-9_$]*\.project_id\b/i);
    expect(definition).toMatch(/\bnew\.created_by\b/i);

    expect(definition).not.toMatch(/\b(?:update\s+(?:only\s+)?|insert\s+into\s+|delete\s+from\s+|merge\s+into\s+)(?:public\.)?project_overrides\b/i);
  });
});
