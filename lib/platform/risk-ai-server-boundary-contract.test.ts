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
const actions = readFileSync(
  resolve(process.cwd(), "app/dashboard/projects/[id]/actions.ts"),
  "utf8",
);

const terminalCommands = [
  "record_m1_risk_ai_usage",
  "finalize_m1_risk_rerun",
  "close_m1_risk_ai_reservation",
] as const;

function finalFunctionSection(name: string): string {
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

  const nextFunction = migration
    .slice(start + 1)
    .search(/\bcreate\s+or\s+replace\s+function\b/i);
  return nextFunction < 0
    ? migration.slice(start)
    : migration.slice(start, start + 1 + nextFunction);
}

function serverAction(name: string): string {
  const start = actions.indexOf(`export async function ${name}`);
  if (start < 0) return "";
  const next = actions.indexOf("\nexport async function ", start + 1);
  return next < 0 ? actions.slice(start) : actions.slice(start, next);
}

describe("risk AI terminal commands use a server-only trust boundary", () => {
  it.each(terminalCommands)(
    "allows only service_role to execute %s",
    (commandName) => {
      const section = finalFunctionSection(commandName);

      expect(section).not.toBe("");
      expect(section).toMatch(
        new RegExp(
          `revoke\\s+all\\s+on\\s+function\\s+public\\.${commandName}[\\s\\S]*?from\\s+public\\s*,\\s*anon\\s*,\\s*authenticated\\s*,\\s*service_role`,
          "i",
        ),
      );
      expect(section).toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${commandName}[\\s\\S]*?to\\s+service_role`,
          "i",
        ),
      );
      expect(section).not.toMatch(
        new RegExp(
          `grant\\s+execute\\s+on\\s+function\\s+public\\.${commandName}[\\s\\S]*?to\\s+authenticated`,
          "i",
        ),
      );
    },
  );

  it.each([
    ["rerunRisks", "reserve_m1_risk_rerun"],
    ["retryWorkflow", "reserve_m1_risk_retry"],
  ])(
    "keeps %s reservation request-bound and terminalizes through admin",
    (actionName, reservationName) => {
      const action = serverAction(actionName);

      expect(action).not.toBe("");
      expect(action).toMatch(
        new RegExp(
          `supabase\\.rpc\\(\\s*["']${reservationName}["']`,
          "i",
        ),
      );
      for (const commandName of terminalCommands) {
        expect(action).not.toMatch(
          new RegExp(
            `supabase\\.rpc\\(\\s*["']${commandName}["']`,
            "i",
          ),
        );
      }
      expect(action).toContain("const terminalClient = createAdminClient()");
      expect(action).toContain(
        'terminalClient.rpc("close_m1_risk_ai_reservation"',
      );
      expect(action).toMatch(/p_error:\s*\{\s*code:\s*[a-zA-Z"]/);
      expect(action).not.toMatch(
        /p_error:\s*\{[\s\S]{0,160}\bmessage\b\s*:/,
      );
    },
  );

  it.each(terminalCommands)(
    "derives and re-authorizes the reserved actor in %s",
    (commandName) => {
      const section = finalFunctionSection(commandName);

      expect(section).toMatch(
        /input_snapshot\s*->>\s*'requested_by'/i,
      );
      expect(section).toMatch(/\bp\.designer_id\s*=\s*v_actor\b/i);
      expect(section).toMatch(
        /\bm\.owner_id\s*=\s*p\.designer_id[\s\S]*?\bm\.member_id\s*=\s*v_actor[\s\S]*?\bm\.status\s*=\s*'active'/i,
      );
      expect(section).not.toContain("private.is_studio_member");
      expect(section).not.toContain("auth.uid()");
      expect(section).toMatch(
        /current_setting\s*\(\s*'request\.jwt\.claim\.role'\s*,\s*true\s*\)/i,
      );
    },
  );
});
