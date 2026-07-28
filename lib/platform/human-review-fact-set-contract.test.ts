import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
  ),
  "utf8",
);

function sqlFunction(name: string): string {
  const start = migration.search(
    new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
      "i",
    ),
  );
  if (start < 0) return "";
  const tail = migration.slice(start);
  const marker = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!marker?.[1] || marker.index === undefined) return "";
  const end = tail.indexOf(marker[1], marker.index + marker[0].length);
  return end < 0 ? "" : tail.slice(0, end + marker[1].length);
}

describe("human review binds an exact immutable fact set", () => {
  it("versions a fact review and audits the new fact atomically", () => {
    const review = sqlFunction("review_project_fact");
    expect(review).not.toBe("");
    expect(review).toMatch(
      /\bnot\s+exists\s*\([\s\S]*?\bsuccessor\.supersedes_id\s*=\s*fact\.id/i,
    );
    expect(review).toMatch(
      /\binsert\s+into\s+public\.project_facts\b[\s\S]*?\bsupersedes_id\b[\s\S]*?\bv_fact\.id\b[\s\S]*?\breturning\s+id\s+into\s+v_new_fact_id/i,
    );
    expect(review).toMatch(
      /\binsert\s+into\s+public\.audit_events\b[\s\S]*?\bentity_id\b[\s\S]*?\bv_new_fact_id\b/i,
    );
  });

  it("removes direct authenticated fact mutation", () => {
    expect(migration).toMatch(
      /\brevoke\s+insert\s*,\s*update\s*,\s*delete\s+on\s+(?:table\s+)?public\.project_facts\s+from\s+anon\s*,\s*authenticated/i,
    );
  });

  it("blocks completion until every current fact has a human decision", () => {
    const complete = sqlFunction("complete_m1_human_review");
    expect(complete).not.toBe("");
    expect(complete).toMatch(
      /\bnot\s+exists\s*\([\s\S]*?\bsuccessor\.supersedes_id\s*=\s*fact\.id[\s\S]*?\bfact\.status\s+not\s+in\s*\(\s*'human_confirmed'\s*,\s*'rejected'\s*\)/i,
    );
    expect(complete).toMatch(
      /\braise\s+exception\s+'all current project facts must be reviewed'/i,
    );
  });

  it("stores the reviewed fact count and SHA-256 digest on approval and workflow evidence", () => {
    const complete = sqlFunction("complete_m1_human_review");
    expect(migration).toMatch(
      /\badd\s+column\s+if\s+not\s+exists\s+reviewed_fact_count\s+integer/i,
    );
    expect(migration).toMatch(
      /\badd\s+column\s+if\s+not\s+exists\s+reviewed_fact_digest\s+text/i,
    );
    expect(complete).toMatch(/\bdigest\s*\([\s\S]*?'sha256'/i);
    expect(complete).toMatch(
      /\breviewed_fact_count\s*=\s*v_fact_count[\s\S]*?\breviewed_fact_digest\s*=\s*v_fact_digest/i,
    );
    expect(complete).toMatch(
      /'reviewed_fact_count'\s*,\s*v_fact_count[\s\S]*?'reviewed_fact_digest'\s*,\s*v_fact_digest/i,
    );
  });
});
