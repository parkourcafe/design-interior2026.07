import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(
  resolve(
    process.cwd(),
    "app/dashboard/projects/[id]/proposal/page.tsx",
  ),
  "utf8",
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
  ),
  "utf8",
);

function latestSqlFunction(name: string): string {
  const starts = Array.from(
    migration.matchAll(
      new RegExp(
        `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`,
        "gi",
      ),
    ),
  );
  const start = starts.at(-1)?.index ?? -1;
  if (start < 0) return "";
  const tail = migration.slice(start);
  const tag = /\bas\s+(\$[a-z0-9_]*\$)/i.exec(tail);
  if (!tag?.[1] || tag.index === undefined) return "";
  const end = tail.indexOf(tag[1], tag.index + tag[0].length);
  return end < 0 ? "" : tail.slice(0, end + tag[1].length);
}

describe("initial M1 proposal draft transaction", () => {
  it("creates legacy state and governed evidence through one guarded RPC", () => {
    const ensure = latestSqlFunction("get_or_create_m1_proposal_draft");

    expect(ensure).not.toBe("");
    expect(ensure).toMatch(/\bsecurity\s+definer\b/i);
    expect(ensure).toMatch(/\bprivate\.is_studio_member\b/i);
    expect(ensure).toMatch(
      /\bfrom\s+public\.projects\b[\s\S]*?\bfor\s+update\b/i,
    );
    expect(ensure).toMatch(/\binsert\s+into\s+public\.proposals\b/i);
    expect(ensure).toMatch(/\bupdate\s+public\.projects\b/i);
    expect(ensure).toMatch(/\binsert\s+into\s+public\.events\b/i);
    expect(ensure).toMatch(
      /\bpublic\.persist_m1_proposal_draft_steps\s*\(/i,
    );

    expect(migration).toMatch(
      /revoke\s+insert\s+on\s+table\s+public\.proposals\s+from\s+authenticated/i,
    );
    expect(migration).toMatch(
      /grant\s+execute\s+on\s+function\s+public\.get_or_create_m1_proposal_draft\s*\([^;]*\)\s+to\s+authenticated/i,
    );
  });

  it("does not perform a multi-statement draft creation sequence in the page", () => {
    expect(page).toMatch(
      /\.rpc\s*\(\s*["']get_or_create_m1_proposal_draft["']/,
    );
    expect(page).not.toMatch(
      /\.from\s*\(\s*["']proposals["']\s*\)[\s\S]{0,160}?\.insert\s*\(/,
    );
    expect(page).not.toMatch(
      /\.from\s*\(\s*["']projects["']\s*\)[\s\S]{0,160}?\.update\s*\(\s*\{\s*status\s*:\s*["']proposal_draft["']/,
    );
    expect(page).not.toMatch(
      /\.from\s*\(\s*["']events["']\s*\)[\s\S]{0,160}?\.insert\s*\(/,
    );
  });
});
