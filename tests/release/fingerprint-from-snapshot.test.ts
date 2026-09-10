import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execute = promisify(execFile);
const script = resolve(process.cwd(), "scripts/ops/fingerprint-from-snapshot.mjs");
const temporaryDirectories: string[] = [];

const emptyCategories = {
  migration_ledger: [],
  schemas: [],
  relations: [],
  columns: [],
  constraints: [],
  indexes: [],
  policies: [],
  functions: [],
  views: [],
  triggers: [],
  enums: [],
  types: [],
  table_grants: [],
  column_grants: [],
  routine_grants: [],
  usage_grants: [],
  default_privileges: [],
  roles: [],
  role_memberships: [],
  schema_role_privileges: [],
  extensions: [],
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    snapshot_contract: "remhaos-production-catalog/2.0",
    captured_at: "2026-09-10T00:00:00Z",
    database: "fixture",
    server_version: "17.6",
    ...emptyCategories,
    schemas: [
      { schema_name: "storage", owner: "supabase_storage_admin", acl: "" },
      { acl: "", owner: "postgres", schema_name: "private" },
    ],
    relations: [
      { schema: "private", name: "approval_requests", kind: "r", row_security: true },
    ],
    functions: [
      { schema: "private", name: "authorize", identity_arguments: "uuid" },
    ],
    table_grants: [
      {
        schema: "private",
        object: "approval_requests",
        grantee: "authenticated",
        privilege: "SELECT",
      },
    ],
    ...overrides,
  };
}

async function temporaryDirectory() {
  const path = await mkdtemp(resolve(tmpdir(), "wp11-fingerprint-"));
  temporaryDirectories.push(path);
  return path;
}

async function runSnapshot(value: unknown, extraArguments: string[] = []) {
  const directory = await temporaryDirectory();
  const snapshotPath = resolve(directory, "snapshot.json");
  await writeFile(snapshotPath, JSON.stringify(value), "utf8");
  return execute(process.execPath, [script, "--snapshot", snapshotPath, ...extraArguments]);
}

function combinedSha(markdown: string) {
  return markdown.match(/combined_summary_sha256=\n([a-f0-9]{64})/)?.[1];
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    recursive: true,
    force: true,
  })));
});

describe("WP-11 production snapshot fingerprint CLI", () => {
  it("is deterministic across capture time, object-key order and category row order", async () => {
    const first = await runSnapshot(snapshot());
    const second = await runSnapshot(snapshot({
      captured_at: "2026-09-10T01:00:00Z",
      schemas: [...snapshot().schemas].reverse(),
    }));

    expect(combinedSha(first.stdout)).toMatch(/^[a-f0-9]{64}$/);
    expect(combinedSha(second.stdout)).toBe(combinedSha(first.stdout));
    expect(first.stdout).toMatch(/\| schemas \| 2 \| `[a-f0-9]{32}` \|/);
  });

  it("accepts one-row Supabase exports and rejects the old snapshot contract", async () => {
    const wrapped = [{ production_schema_snapshot: JSON.stringify(snapshot()) }];
    const accepted = await runSnapshot(wrapped);
    expect(accepted.stdout).toContain("Database: `fixture`");

    await expect(runSnapshot(snapshot({
      snapshot_contract: "project-intelligence-production-schema/1.0",
    }))).rejects.toMatchObject({
      stderr: expect.stringMatching(/unsupported snapshot_contract/),
    });
  });

  it("rejects unknown and duplicate CLI options", async () => {
    await expect(runSnapshot(snapshot(), ["--typo", "value"])).rejects.toMatchObject({
      stderr: expect.stringMatching(/unknown option: --typo/),
    });
    await expect(runSnapshot(snapshot(), ["--snapshot", "another.json"])).rejects.toMatchObject({
      stderr: expect.stringMatching(/duplicate option: --snapshot/),
    });
  });

  it("writes only changed and new-category rows to the drift CSV", async () => {
    const initial = await runSnapshot(snapshot());
    const schemas = initial.stdout.match(/\| schemas \| (\d+) \| `([a-f0-9]{32})` \|/);
    expect(schemas).not.toBeNull();

    const directory = await temporaryDirectory();
    const baselinePath = resolve(directory, "baseline.md");
    const conflictsPath = resolve(directory, "conflicts.csv");
    await writeFile(baselinePath, [
      "| Category | Count | MD5 |",
      "|---|---:|---|",
      `| schemas | ${schemas?.[1]} | \`${schemas?.[2]}\` |`,
      `| relations | 99 | \`${"a".repeat(32)}\` |`,
    ].join("\n"), "utf8");

    await runSnapshot(snapshot(), [
      "--baseline",
      baselinePath,
      "--conflicts-out",
      conflictsPath,
    ]);
    const csv = await readFile(conflictsPath, "utf8");

    expect(csv).toMatch(/^id,conflict,status,evidence,resolution\n/);
    expect(csv).not.toContain("schemas:");
    expect(csv).toContain("relations: catalog fingerprint changed");
    expect(csv).toContain("columns: category absent");
  });

  it("keeps the v2 SQL catalog-only and dynamically scopes non-system schemas", async () => {
    const sql = await readFile(
      resolve(
        process.cwd(),
        "docs/product-intelligence/agent-runs/db-wave/PRODUCTION_READONLY_AUDIT_v2.sql",
      ),
      "utf8",
    );
    const executable = sql.replace(/^--.*$/gm, "");

    expect(executable).toMatch(/scope_schemas as \(/);
    expect(executable).toMatch(/n\.nspname not in \('pg_catalog', 'information_schema'\)/);
    expect(executable).toMatch(/from supabase_migrations\.schema_migrations/);
    expect(executable).not.toMatch(/\b(insert|update|delete|alter|drop|truncate)\b/i);
    expect(executable).not.toMatch(/\bcreate\s+(table|function|policy|schema|extension)\b/i);
  });
});
