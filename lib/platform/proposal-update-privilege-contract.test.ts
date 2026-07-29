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

describe("proposal write privilege contract", () => {
  it("lets authenticated members edit draft sections but never set issuance state directly", () => {
    expect(migration).toMatch(
      /\brevoke\s+update\s+on\s+(?:table\s+)?public\.proposals\s+from\s+authenticated\b/i,
    );
    expect(migration).toMatch(
      /\bgrant\s+update\s*\(\s*sections\s*\)\s+on\s+(?:table\s+)?public\.proposals\s+to\s+authenticated\b/i,
    );
    expect(migration).not.toMatch(
      /\bgrant\s+update\s*\([^)]*\b(?:status|sent_at|issued_revision_id)\b[^)]*\)\s+on\s+(?:table\s+)?public\.proposals\s+to\s+authenticated\b/i,
    );
    expect(migration).toMatch(
      /\bgrant\s+execute\s+on\s+function\s+public\.issue_proposal_revision\s*\(\s*uuid\s*,\s*uuid\s*\)\s+to\s+authenticated\b/i,
    );
  });
});
