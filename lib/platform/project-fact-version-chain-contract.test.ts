import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase/migrations");
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((filename) => filename.endsWith(".sql"))
  .sort();

const migrations = migrationFiles.map((filename) => ({
  filename,
  sql: readFileSync(join(migrationsDirectory, filename), "utf8"),
}));

const foundationSql =
  migrations.find(
    ({ filename }) => filename === "0007_platform_foundation_m1.sql",
  )?.sql ?? "";
const completionSql =
  migrations.find(
    ({ filename }) =>
      filename === "20260728013000_complete_m1_governed_runtime.sql",
  )?.sql ?? "";

const stripSqlComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--.*$/gm, " ");

const normalizedFoundationSql = stripSqlComments(foundationSql).replace(
  /"/g,
  "",
);
const normalizedCompletionSql = stripSqlComments(completionSql).replace(
  /"/g,
  "",
);

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

const projectFactTriggerFunction = (
  sql: string,
  requiredEvents: readonly string[],
): string | null => {
  const triggerStatements = Array.from(
    sql.matchAll(
      /\bcreate\s+(?:or\s+replace\s+)?trigger\b[\s\S]*?;/gi,
    ),
    (match) => match[0],
  );

  const trigger = triggerStatements.find(
    (statement) =>
      /\bbefore\b/i.test(statement) &&
      /\bon\s+(?:public\.)?project_facts\b/i.test(statement) &&
      requiredEvents.every((event) =>
        new RegExp(`\\b${escapeRegExp(event)}\\b`, "i").test(statement),
      ),
  );

  return (
    /\bexecute\s+(?:function|procedure)\s+([a-z_][a-z0-9_$]*(?:\.[a-z_][a-z0-9_$]*)?)\s*\(/i.exec(
      trigger ?? "",
    )?.[1] ?? null
  );
};

const projectFactsTableBody = (
  /\bcreate\s+table\s+(?:public\.)?project_facts\s*\(([\s\S]*?)\n\);/i.exec(
    normalizedFoundationSql,
  )?.[1] ?? ""
);

const columnIsMandatory = (
  columnName: string,
  insertGuard: string,
): boolean => {
  const inlineDefinition = new RegExp(
    `(?:^|\\n)\\s*${escapeRegExp(columnName)}\\b[^,\\n]*\\bnot\\s+null\\b`,
    "i",
  ).test(projectFactsTableBody);
  const additiveConstraint = new RegExp(
    `\\balter\\s+table\\s+(?:only\\s+)?(?:public\\.)?project_facts\\b[\\s\\S]*?\\balter\\s+column\\s+${escapeRegExp(columnName)}\\s+set\\s+not\\s+null\\b`,
    "i",
  ).test(normalizedCompletionSql);
  const guardedNull = new RegExp(
    `\\bnew\\.${escapeRegExp(columnName)}\\s+is\\s+null\\b[\\s\\S]*?\\braise\\s+exception\\b`,
    "i",
  ).test(insertGuard);

  return inlineDefinition || additiveConstraint || guardedNull;
};

const comparesLineageField = (
  definition: string,
  field: "project_id" | "fact_type" | "evidence_locator",
): boolean => {
  const predecessorFirst = new RegExp(
    `\\b[a-z_][a-z0-9_$]*\\.${field}\\s*(?:=|is\\s+distinct\\s+from)\\s*new\\.${field}\\b`,
    "i",
  );
  const newFirst = new RegExp(
    `\\bnew\\.${field}\\s*(?:=|is\\s+distinct\\s+from)\\s*[a-z_][a-z0-9_$]*\\.${field}\\b`,
    "i",
  );

  return predecessorFirst.test(definition) || newFirst.test(definition);
};

const quotedValues = (list: string): string[] =>
  Array.from(list.matchAll(/'([^']+)'/g), (match) => match[1]!).sort();

describe("project_facts immutable version-chain migration contract", () => {
  it("keeps every persisted fact attributable and complete", () => {
    const insertGuardName = projectFactTriggerFunction(
      normalizedCompletionSql,
      ["insert"],
    );
    const insertGuard = insertGuardName
      ? extractFunctionDefinition(normalizedCompletionSql, insertGuardName) ?? ""
      : "";

    for (const column of [
      "project_id",
      "fact_type",
      "value",
      "source_id",
      "evidence_locator",
      "status",
      "confidence",
      "created_by_type",
      "version",
      "created_at",
    ]) {
      expect(
        columnIsMandatory(column, insertGuard),
        `project_facts.${column} must be mandatory via NOT NULL or the insert guard`,
      ).toBe(true);
    }
  });

  it("rejects direct mutation while permitting only a parent-project cascade", () => {
    const immutableGuardName = projectFactTriggerFunction(
      normalizedCompletionSql,
      ["update", "delete"],
    );
    expect(
      immutableGuardName,
      "project_facts needs one BEFORE UPDATE OR DELETE immutability trigger",
    ).not.toBeNull();

    const immutableGuard = immutableGuardName
      ? extractFunctionDefinition(normalizedCompletionSql, immutableGuardName)
      : null;
    expect(
      immutableGuard,
      "the project_facts immutability trigger function must be defined in the completion migration",
    ).not.toBeNull();
    expect(immutableGuard!).toMatch(/\breturns\s+trigger\b/i);
    expect(immutableGuard!).toMatch(/\bset\s+search_path\s*(?:=|to)\s*''/i);
    expect(immutableGuard!).toMatch(
      /\btg_op\s*=\s*'DELETE'[\s\S]*?\bnot\s+exists\s*\([\s\S]*?\bfrom\s+(?:public\.)?projects\b[\s\S]*?\bproject\.id\s*=\s*old\.project_id[\s\S]*?\breturn\s+old\b/i,
    );
    expect(immutableGuard!).toMatch(/\braise\s+exception\b/i);
  });

  it("allows only a locked linear successor in the same logical lineage", () => {
    const insertGuardName = projectFactTriggerFunction(
      normalizedCompletionSql,
      ["insert"],
    );
    expect(
      insertGuardName,
      "project_facts needs a BEFORE INSERT version-chain guard",
    ).not.toBeNull();

    const insertGuard = insertGuardName
      ? extractFunctionDefinition(normalizedCompletionSql, insertGuardName)
      : null;
    expect(
      insertGuard,
      "the project_facts version-chain guard must be defined in the completion migration",
    ).not.toBeNull();

    const definition = insertGuard!;
    expect(definition).toMatch(/\breturns\s+trigger\b/i);
    expect(definition).toMatch(/\bset\s+search_path\s*(?:=|to)\s*''/i);
    expect(
      definition,
      "a root fact has no predecessor and must start at version 1",
    ).toMatch(
      /\bif\s+new\.supersedes_id\s+is\s+null\s+then\b[\s\S]*?\bif\s+new\.version\s*(?:<>|!=)\s*1\s+then\b[\s\S]*?\braise\s+exception\b/i,
    );
    expect(
      definition,
      "a successor must load the exact predecessor",
    ).toMatch(
      /\bselect\b[\s\S]*?\binto\b[\s\S]*?\bfrom\s+(?:public\.)?project_facts\b[\s\S]*?\bwhere\b[\s\S]*?\bid\s*=\s*new\.supersedes_id\b/i,
    );
    expect(
      definition,
      "the predecessor must be locked before successor validation",
    ).toMatch(/\bfor\s+(?:no\s+key\s+)?update\b/i);

    for (const field of [
      "project_id",
      "fact_type",
      "evidence_locator",
    ] as const) {
      expect(
        comparesLineageField(definition, field),
        `a successor must retain predecessor.${field}`,
      ).toBe(true);
    }

    expect(
      definition,
      "a successor version must be exactly predecessor.version + 1",
    ).toMatch(
      /\bnew\.version\s*(?:<>|!=)\s*[a-z_][a-z0-9_$]*\.version\s*\+\s*1\b/i,
    );
    expect(
      normalizedCompletionSql,
      "a unique partial index must prevent two successors from branching from one fact",
    ).toMatch(
      /\bcreate\s+unique\s+index\b[\s\S]*?\bon\s+(?:public\.)?project_facts\s*\(\s*supersedes_id\s*\)[\s\S]*?\bwhere\s+supersedes_id\s+is\s+not\s+null\b/i,
    );
  });

  it("restricts AI-authored facts to non-confirming extraction statuses", () => {
    const insertGuardName = projectFactTriggerFunction(
      normalizedCompletionSql,
      ["insert"],
    );
    const insertGuard = insertGuardName
      ? extractFunctionDefinition(normalizedCompletionSql, insertGuardName)
      : null;
    expect(insertGuard).not.toBeNull();

    const definition = insertGuard!;
    expect(definition).toMatch(
      /\bnew\.created_by_type\s*=\s*'ai'\b|'ai'\s*=\s*new\.created_by_type\b/i,
    );

    const statusConditions = Array.from(
      definition.matchAll(
        /\bnew\.status\s+(not\s+)?in\s*\(([^)]*)\)/gi,
      ),
      (match) => ({
        negated: Boolean(match[1]),
        values: quotedValues(match[2] ?? ""),
      }),
    );
    const allowedStatuses = ["extracted", "interpreted", "unknown"].sort();
    const forbiddenStatuses = ["human_confirmed", "rejected"].sort();
    const hasSafeAiStatusGuard = statusConditions.some(
      ({ negated, values }) =>
        (negated &&
          values.length === allowedStatuses.length &&
          values.every((value, index) => value === allowedStatuses[index])) ||
        (!negated &&
          forbiddenStatuses.every((status) => values.includes(status))),
    );

    expect(
      hasSafeAiStatusGuard,
      "AI facts may only use extracted/interpreted/unknown, never human_confirmed or rejected",
    ).toBe(true);
  });

  it("requires the provenance source to belong to the same project", () => {
    const insertGuardName = projectFactTriggerFunction(
      normalizedCompletionSql,
      ["insert"],
    );
    const insertGuard = insertGuardName
      ? extractFunctionDefinition(normalizedCompletionSql, insertGuardName) ?? ""
      : "";

    expect(insertGuard).toMatch(
      /\bfrom\s+(?:public\.)?project_sources\b[\s\S]*?\bid\s*=\s*new\.source_id\b[\s\S]*?\bproject_id\s*=\s*new\.project_id\b/i,
    );
    expect(insertGuard).toMatch(/\bfor\s+(?:key\s+share|share|update)\b/i);
    expect(insertGuard).toMatch(
      /\bif\s+not\s+found\s+then\b[\s\S]*?\braise\s+exception\b/i,
    );
  });
});
