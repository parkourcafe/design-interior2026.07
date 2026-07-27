import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrations = join(process.cwd(), "supabase/migrations");
const markerPath = join(
  migrations,
  "20260719020040_remote_schema.sql",
);
const bridgePath = join(
  migrations,
  "20260719021000_remote_schema_compatibility_bridge.sql",
);

describe("production migration baseline reconciliation", () => {
  it("represents the production snapshot version without replaying its overlapping dump", () => {
    expect(existsSync(markerPath)).toBe(true);
    const marker = readFileSync(markerPath, "utf8");
    expect(marker).toContain("history marker");
    expect(marker).not.toMatch(/\bcreate\s+table\b/i);
    expect(marker).not.toMatch(/\bcreate\s+policy\b/i);
  });

  it("reconstructs production-only application compatibility objects additively", () => {
    expect(existsSync(bridgePath)).toBe(true);
    const bridge = readFileSync(bridgePath, "utf8");

    for (const table of [
      "project_rooms",
      "project_participants",
      "project_tasks",
      "project_task_events",
    ]) {
      expect(bridge).toMatch(
        new RegExp(String.raw`create\s+table\s+if\s+not\s+exists\s+public\.${table}\b`, "i"),
      );
      expect(bridge).toMatch(
        new RegExp(String.raw`alter\s+table\s+public\.${table}\s+enable\s+row\s+level\s+security`, "i"),
      );
      expect(bridge).toContain(`${table}_studio_all`);
    }

    expect(bridge).toContain("'proposal_accepted'");
    expect(bridge).toContain("'active_project'");
    expect(bridge).toContain("'accepted'");
    expect(bridge).not.toMatch(/\bdrop\s+table\b/i);
    expect(bridge).not.toMatch(/\btruncate\b/i);
  });
});
