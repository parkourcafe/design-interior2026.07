import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildManifest } from "../../../scripts/ops/create-adoption-rehearsal-manifest.mjs";

const root = resolve(__dirname, "../../..");
const snapshot = Buffer.from(JSON.stringify({ snapshot_contract: "remhaos-production-catalog/2.0", database: "postgres", captured_at: "2026-09-12T00:00:00Z", migration_ledger: Array.from({ length: 23 }, (_, index) => ({ version: String(index) })) }));

// The ledger must bind the repository's own migration set. Deriving the
// expected count here instead of pinning a number keeps the assertion true
// after the next migration and still fails if the two ever diverge.
const migrationFiles = readdirSync(resolve(root, "supabase/migrations")).filter((name) => name.endsWith(".sql"));

const temporaryRoots: string[] = [];
afterEach(() => {
  for (const path of temporaryRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** A throwaway git repository holding a chosen subset of the real migrations. */
function repositoryWithMigrations(names: readonly string[]) {
  const repository = mkdtempSync(resolve(tmpdir(), "r1-adoption-ledger-"));
  temporaryRoots.push(repository);
  mkdirSync(resolve(repository, "supabase/migrations"), { recursive: true });
  mkdirSync(resolve(repository, "tests/ap1/environment"), { recursive: true });
  const lines: string[] = [];
  for (const name of names) {
    const source = resolve(root, "supabase/migrations", name);
    copyFileSync(source, resolve(repository, "supabase/migrations", name));
    const digest = createHash("sha256").update(readFileSync(source)).digest("hex");
    lines.push(`${digest}  supabase/migrations/${name}`);
  }
  writeFileSync(resolve(repository, "tests/ap1/environment/migration-ledger.sha256"), `${lines.join("\n")}\n`);
  for (const path of ["supabase/roles.sql", "tests/ap1/environment/verify-db.sql", "tests/ap1/environment/apply-hosted-role-precondition.sql"]) {
    mkdirSync(resolve(repository, path, ".."), { recursive: true });
    copyFileSync(resolve(root, path), resolve(repository, path));
  }
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repository, stdio: "ignore" });
  git("init", "--quiet");
  git("-c", "user.email=fixture@example.test", "-c", "user.name=fixture", "commit", "--quiet", "--allow-empty", "-m", "fixture");
  return repository;
}

describe("adoption rehearsal manifest", () => {
  it("binds the repository's exact current source set to the restored clone and snapshot", () => {
    const manifest = buildManifest({ repository: root, targetRef: "reitdpzxtnmdkznesffu", snapshotBytes: snapshot, now: "2026-09-12T00:00:00Z" });
    expect(manifest.executionAuthorized).toBe(false);
    expect(manifest.source.migrationCount).toBe(migrationFiles.length);
    expect(manifest.source.migrations.map((entry: { path: string }) => entry.path).sort())
      .toEqual(migrationFiles.map((name) => `supabase/migrations/${name}`).sort());
    expect(manifest.source.commit).toBe(execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim());
    expect(manifest.preconditions.legacyHistoryCount).toBe(23);
    expect(manifest.preconditions.baselineHistoryRepair.executionAuthorized).toBe(false);
  });

  it("rejects a target ref, snapshot contract, or legacy-history count outside the reviewed contract", () => {
    expect(() => buildManifest({ repository: root, targetRef: "wrong", snapshotBytes: snapshot })).toThrow("ADOPTION_MANIFEST_TARGET_REF_INVALID");
    expect(() => buildManifest({ repository: root, targetRef: "reitdpzxtnmdkznesffu", snapshotBytes: Buffer.from("{}") })).toThrow("ADOPTION_MANIFEST_SNAPSHOT_CONTRACT_INVALID");
    expect(() => buildManifest({ repository: root, targetRef: "reitdpzxtnmdkznesffu", snapshotBytes: Buffer.from(JSON.stringify({ snapshot_contract: "remhaos-production-catalog/2.0", database: "postgres", migration_ledger: [] })) })).toThrow("ADOPTION_MANIFEST_SNAPSHOT_HISTORY_INVALID");
  });

  it("accepts a ledger that matches its repository whatever the migration count", () => {
    const repository = repositoryWithMigrations(migrationFiles.slice(0, 3));
    const manifest = buildManifest({ repository, targetRef: "reitdpzxtnmdkznesffu", snapshotBytes: snapshot, now: "2026-09-12T00:00:00Z" });
    expect(manifest.source.migrationCount).toBe(3);
  });

  it("refuses a ledger that does not cover every migration in its repository", () => {
    const repository = repositoryWithMigrations(migrationFiles.slice(0, 3));
    copyFileSync(
      resolve(root, "supabase/migrations", migrationFiles[3]!),
      resolve(repository, "supabase/migrations", migrationFiles[3]!),
    );
    expect(() => buildManifest({ repository, targetRef: "reitdpzxtnmdkznesffu", snapshotBytes: snapshot }))
      .toThrow("ADOPTION_MANIFEST_LEDGER_NOT_CURRENT");
  });
});
