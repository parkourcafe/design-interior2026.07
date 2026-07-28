import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const completion = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260728013000_complete_m1_governed_runtime.sql",
  ),
  "utf8",
);

describe("production compatibility policies use the private membership boundary", () => {
  for (const [table, ownerJoin] of [
    ["project_rooms", "project_rooms.project_id"],
    ["project_participants", "project_participants.room_id"],
    ["project_tasks", "project_tasks.room_id"],
    ["project_task_events", "project_task_events.room_id"],
  ] as const) {
    it(`replaces ${table} policy with the executable private helper`, () => {
      expect(completion).toMatch(
        new RegExp(
          `drop\\s+policy\\s+if\\s+exists\\s+${table}_studio_all\\s+on\\s+public\\.${table}`,
          "i",
        ),
      );
      const policy = new RegExp(
        `create\\s+policy\\s+${table}_studio_all\\s+on\\s+public\\.${table}[\\s\\S]*?;`,
        "i",
      ).exec(completion)?.[0];
      expect(policy).toBeDefined();
      expect(policy).toMatch(/\bto\s+authenticated\b/i);
      expect(policy).toMatch(/\bprivate\.is_studio_member\s*\(\s*p\.designer_id\s*\)/i);
      expect(policy).not.toMatch(/\bpublic\.is_studio_member\s*\(/i);
      expect(policy).toContain(ownerJoin);
    });
  }

  it("removes non-row-level privileges and all anonymous table access", () => {
    expect(completion).toMatch(
      /\brevoke\s+all\s+on\s+all\s+tables\s+in\s+schema\s+public\s+from\s+anon/i,
    );
    expect(completion).toMatch(
      /\brevoke\s+truncate\s*,\s*trigger\s*,\s*references\s+on\s+all\s+tables\s+in\s+schema\s+public\s+from\s+authenticated/i,
    );
  });

  it("regrants compatibility tables only row-level CRUD", () => {
    for (const table of [
      "project_rooms",
      "project_participants",
      "project_tasks",
      "project_task_events",
    ]) {
      expect(completion).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+table[\\s\\S]*?public\\.${table}[\\s\\S]*?from\\s+authenticated`,
          "i",
        ),
      );
    }
    expect(completion).toMatch(
      /\bgrant\s+select\s*,\s*insert\s*,\s*update\s*,\s*delete\s+on\s+table[\s\S]*?public\.project_task_events[\s\S]*?to\s+authenticated/i,
    );
  });

  it("declares the authenticated core application privilege matrix explicitly", () => {
    for (const grant of [
      /grant\s+select\s*,\s*insert\s*,\s*update\s+on\s+table\s+public\.designers\s+to\s+authenticated/i,
      /grant\s+select\s*,\s*insert\s*,\s*update\s*,\s*delete\s+on\s+table\s+public\.projects\s+to\s+authenticated/i,
      /grant\s+select\s+on\s+table\s+public\.answers\s+to\s+authenticated/i,
      /grant\s+select\s*,\s*update\s+on\s+table\s+public\.risk_cards\s+to\s+authenticated/i,
      /revoke\s+insert\s+on\s+table\s+public\.proposals\s+from\s+authenticated/i,
      /grant\s+select\s+on\s+table\s+public\.proposals\s+to\s+authenticated/i,
      /grant\s+select\s*,\s*insert\s+on\s+table\s+public\.events\s+to\s+authenticated/i,
      /grant\s+select\s*,\s*insert\s*,\s*delete\s+on\s+table\s+public\.studio_members\s+to\s+authenticated/i,
    ]) {
      expect(completion).toMatch(grant);
    }
  });
});
