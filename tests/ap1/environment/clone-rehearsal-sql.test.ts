import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { compileCloneRehearsalSql, normalizeMigrationSql, scanSqlStatements, SQL_PINS } from "../../../scripts/ops/clone-rehearsal-sql.mjs";

const root = resolve(__dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path));
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

// Reconstruct the historical public manifest, preserving its exact key order.
// Later additive ledger entries are not part of this already-authorized source.
function frozenInputs() {
  const ledgerBytes = Buffer.from(read("tests/ap1/environment/migration-ledger.sha256").toString().trim().split("\n").slice(0, 98).join("\n") + "\n");
  const migrations = ledgerBytes.toString().trim().split("\n").map((line) => {
    const [sha256, path] = line.split("  ");
    if (!sha256 || !path) throw new Error("Invalid historical ledger fixture");
    return { sha256, path, version: path.split("/").at(-1)!.slice(0, 14) };
  });
  const auxiliary = {
    "supabase/roles.sql": "74f113ebc86b31adfdd92bb62c2537864229616b89d086168afb568d37d72cfc",
    "tests/ap1/environment/verify-db.sql": "b293afaedaf76d21f45126945e4fa4841edb634be3bd1530db1ff9461657337d",
    "tests/ap1/environment/apply-hosted-role-precondition.sql": "9fd586c35060db25d62186355990bd3eaeda325947957168d69129c658381bfb",
  };
  const manifest = {
    contract: "remhaos-adoption-rehearsal-manifest/1.0", status: "REVIEW_REQUIRED", executionAuthorized: false,
    createdAt: "2026-09-12T03:09:21.700Z", target: { projectRef: "reitdpzxtnmdkznesffu", database: "postgres" },
    source: { commit: SQL_PINS.sourceCommit, ledgerPath: "tests/ap1/environment/migration-ledger.sha256",
      ledgerSha256: SQL_PINS.ledgerSha256, migrationCount: 98, migrations },
    preconditions: { snapshotSha256: "8830df17d116cce0426df1cabb58d44929ab26842b7a840f20d9756ff39bbecd",
      snapshotCapturedAt: "2026-09-11T15:25:50.251765+00:00", legacyHistoryCount: 23, auxiliary,
      baselineHistoryRepair: { status: "SEPARATE_ARTIFACT_REQUIRED", executionAuthorized: false } },
  };
  return { manifest, ledgerBytes, migrationBytes: Object.fromEntries(migrations.map((m) => [m.path, read(m.path)])),
    auxiliaryBytes: Object.fromEntries(Object.keys(auxiliary).map((p) => [p, read(p)])) };
}

describe("clone SQL lexical boundaries", () => {
  it("preserves body bytes while ignoring fake transaction words in quotes and nested comments", () => {
    const body = `\n/* outer /* COMMIT; */ still comment */\nDO $body$ BEGIN RAISE NOTICE 'COMMIT;'; END $body$;\nSELECT E'escaped\\\';COMMIT;', 'it''s;fine', "COMMIT;", 'back\\slash';`;
    const source = `BEGIN;${body}\nCOMMIT;`;
    const result = normalizeMigrationSql(source, { wrapped: true });
    expect(result.inventory.map((s: { class: string }) => s.class)).toEqual(["DO", "SELECT"]);
    expect(result.sql.replace(/;\n\nSELECT/, ";\nSELECT")).toBe(body);
    expect(result.inventory[0].proceduralOrCatalogReviewRequired).toBe(true);
    expect(Object.isFrozen(result.inventory[0].tokens)).toBe(true);
  });
  it.each([
    "SELECT 'unterminated;", 'SELECT "unterminated;', "DO $tag$ unfinished;", "/* nested /* x */",
    "SELECT (1;", "SELECT 1);", "SELECT 1", "SELECT E'escaped\\';", "SELECT 1;\0",
    "\\connect evil\nSELECT 1;", "SELECT :value;", "SELECT :'value';", "SELECT 1;\\gexec",
  ])("refuses malformed or psql-controlled input: %s", (sql) => {
    expect(() => scanSqlStatements(sql)).toThrow(/CLONE_SQL_/);
  });
  it.each([
    "BEGIN; SELECT 1; COMMIT;", "COMMIT AND CHAIN;", "ROLLBACK;", "END;", "START TRANSACTION;",
    "SAVEPOINT a;", "RELEASE SAVEPOINT a;", "PREPARE TRANSACTION 'x';", "SET TRANSACTION READ ONLY;",
    "VACUUM;", "REINDEX INDEX a;", "ALTER SYSTEM SET x=1;", "CREATE DATABASE x;", "DROP TABLESPACE x;",
    "CREATE INDEX CONCURRENTLY x ON t(a);", "ALTER TYPE t ADD VALUE 'x';", "COPY t FROM PROGRAM 'x';",
    "SET LOCAL search_path = 'a', 'b';", "SET ROLE postgres;", "SET LOCAL check_function_bodies=off;",
  ])("rejects extra controls or unsupported statements: %s", (sql) => {
    expect(() => normalizeMigrationSql(sql, { wrapped: false })).toThrow(/CLONE_SQL_/);
  });
  it("requires exact outer wrappers and only inventories approved local settings", () => {
    expect(() => normalizeMigrationSql("BEGIN WORK; SELECT 1; COMMIT;", { wrapped: true })).toThrow("WRAPPER_MISMATCH");
    expect(() => normalizeMigrationSql("BEGIN; SELECT 1; COMMIT AND CHAIN;", { wrapped: true })).toThrow("WRAPPER_MISMATCH");
    const result = normalizeMigrationSql("BEGIN; SET LOCAL search_path=''; SET check_function_bodies=on; COMMIT;", { wrapped: true });
    expect(result.localSettings).toEqual(["search_path"]);
    expect(result.boundary).toBe("FORMER_COMMIT_REQUIRES_VERIFIED_CONSTRAINT_RESET");
    expect(result.sql).not.toContain("SET CONSTRAINTS");
  });
});

describe("frozen clone SQL inventory", () => {
  it("verifies all 98 originals and three auxiliaries, excludes baseline, and refuses execution-readiness", () => {
    const input = frozenInputs();
    expect(hash(JSON.stringify(input.manifest))).toBe(SQL_PINS.manifestSha256);
    const plan = compileCloneRehearsalSql(input);
    expect(plan.migrations).toHaveLength(97);
    expect(plan.migrations.filter((m: { boundary: string }) => m.boundary.startsWith("FORMER"))).toHaveLength(94);
    expect(plan.migrations.some((m: { version: string }) => m.version === SQL_PINS.baselineVersion)).toBe(false);
    expect(plan.auxiliary.filter((a: { driverDirective: string | null }) => a.driverDirective)).toHaveLength(2);
    expect(plan.auxiliary.every((a: { sql: string }) => !a.sql.includes("\\set"))).toBe(true);
    expect(plan.executionReady).toBe(false);
    expect(plan.unresolved).toContain("QUALIFIED_CONSTRAINT_MODE_BOUNDARIES");
    const before = JSON.stringify(plan);
    Object.values(input.migrationBytes).forEach((bytes) => bytes.fill(0));
    expect(JSON.stringify(plan)).toBe(before);
    expect(Object.isFrozen(plan.migrations[0])).toBe(true);
  });
  it("refuses changed manifest/order/target, baseline bytes, ledger or auxiliary before returning a plan", () => {
    const corrupt = (bytes: Buffer | undefined) => {
      if (!bytes) throw new Error("Missing fixture bytes");
      bytes.writeUInt8(bytes.readUInt8(0) ^ 1, 0);
    };
    for (const mutate of [
      (x: ReturnType<typeof frozenInputs>) => { x.manifest.source.migrations.reverse(); },
      (x: ReturnType<typeof frozenInputs>) => { x.manifest.target.projectRef = "ztnycrchwxqczqbyegnp"; },
      (x: ReturnType<typeof frozenInputs>) => {
        const baseline = x.manifest.source.migrations[0];
        if (!baseline) throw new Error("Missing baseline fixture");
        corrupt(x.migrationBytes[baseline.path]);
      },
      (x: ReturnType<typeof frozenInputs>) => { corrupt(x.ledgerBytes); },
      (x: ReturnType<typeof frozenInputs>) => { corrupt(x.auxiliaryBytes["supabase/roles.sql"]); },
    ]) {
      const input = frozenInputs(); mutate(input);
      expect(() => compileCloneRehearsalSql(input)).toThrow(/DIGEST_MISMATCH/);
    }
  });
});
