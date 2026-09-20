import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../..");
const scriptPath = resolve(repoRoot, "tests/ap1/environment/adopt-production.zsh");
const baselinePath = resolve(repoRoot, "reconciliation-2026-09/baseline-adoption.sql");
const script = readFileSync(scriptPath, "utf8");
const baseline = readFileSync(baselinePath, "utf8");
const zshAvailable = spawnSync("zsh", ["--version"], { encoding: "utf8" }).status === 0;
const dockerAvailable = spawnSync("docker", ["version"], { encoding: "utf8" }).status === 0;

function allowlist(ref: string) {
  const directory = mkdtempSync(resolve(tmpdir(), "wp13-allowlist-"));
  const path = resolve(directory, "target-ref.txt");
  writeFileSync(path, `${ref}\n`);
  return {
    path,
    dispose: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function run(args: string[], env: Record<string, string> = {}) {
  return spawnSync("zsh", [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("WP-13 historical production adoption contract", () => {
  it("keeps baseline adoption as a transaction that repairs history only", () => {
    expect(baseline).toContain("begin;");
    expect(baseline).toContain("commit;");
    expect(baseline).toContain("AP1_BASELINE_FINGERPRINT_MISMATCH");
    expect(baseline).toContain("AP1_BASELINE_ALREADY_ADOPTED");
    expect(baseline).toContain("\\quit 64");
    expect(baseline).toContain("insert into supabase_migrations.schema_migrations");
    expect(baseline).toContain("20260716071024");
    expect(baseline).not.toMatch(/\b(?:create|alter|drop)\s+(?:table|schema|function|policy)\b/i);
  });

  it("requires snapshot counts rather than embedding stale production metadata", () => {
    for (const variable of [
      "AP1_EXPECTED_RELATIONS",
      "AP1_EXPECTED_ROUTINES",
      "AP1_EXPECTED_POLICIES",
      "AP1_EXPECTED_LEDGER_ROWS",
    ]) {
      expect(baseline).toContain(variable);
      expect(script).toContain(variable);
    }
    expect(script).toContain("AP1_ADOPTION_LEDGER_ROWS_MUST_BE_23");
  });

  it("checks the immutable ledger before each additive migration", () => {
    expect(script).toContain("sha256sum --check \"${ledger_path}\"");
    expect(script).toContain("AP1_ADOPTION_MIGRATION_DIGEST_MISMATCH");
    expect(script).toContain("${ledger_lines[@]:1}");
    expect(script).toContain("AP1_ADOPTION_VERIFY_DB_OK");
    expect(script).toContain("modules_opened=false deployment_performed=false");
  });

  describe.skipIf(!zshAvailable)("operator refusal paths", () => {
    it("refuses without Approval B before any target connection", () => {
      const ref = allowlist("prod");
      try {
        const result = run(["--target-ref", "prod", "--allowlist-ref", ref.path]);
        expect(result.status).toBe(64);
        expect(result.stderr).toContain("AP1_ADOPTION_APPROVAL_RECORD_REQUIRED");
      } finally {
        ref.dispose();
      }
    });

    it("refuses a target not named by the local allowlist", () => {
      const ref = allowlist("approved-clone");
      try {
        const result = run(
          ["--target-ref", "other-clone", "--allowlist-ref", ref.path],
          { AP1_APPROVAL_RECORD: "Approval B: test" },
        );
        expect(result.status).toBe(65);
        expect(result.stderr).toContain("AP1_ADOPTION_REF_NOT_ALLOWLISTED");
      } finally {
        ref.dispose();
      }
    });

    it("rejects an Approval B label without its record identifier", () => {
      const ref = allowlist("approved-clone");
      try {
        const result = run(
          ["--target-ref", "approved-clone", "--allowlist-ref", ref.path],
          { AP1_APPROVAL_RECORD: "Approval B:" },
        );
        expect(result.status).toBe(64);
        expect(result.stderr).toContain("AP1_ADOPTION_APPROVAL_RECORD_INVALID");
      } finally {
        ref.dispose();
      }
    });

    it("refuses every non-disposable target before reading its connection details", () => {
      const ref = allowlist("approved-clone");
      try {
        const result = run(
          ["--target-ref", "approved-clone", "--allowlist-ref", ref.path],
          {
            AP1_APPROVAL_RECORD: "Approval B: test",
            AP1_DB_URL: "postgresql://operator:fixture@db.other-clone.example.test:5432/postgres",
          },
        );
        expect(result.status).toBe(69);
        expect(result.stderr).toContain("AP1_ADOPTION_SHARED_TARGET_DISABLED");
        expect(result.stderr).not.toContain("fixture");
      } finally {
        ref.dispose();
      }
    });
  });

  describe.skipIf(!zshAvailable || !dockerAvailable)("disposable execution failures", () => {
    it("fails closed when the baseline SQL precondition rejects the catalog", () => {
      const ref = allowlist("rehearsal-local");
      try {
        const result = run(
          ["--target-ref", "rehearsal-local", "--allowlist-ref", ref.path, "--dry-run"],
          {
            AP1_APPROVAL_RECORD: "Approval B: local-dry-run",
            AP1_EXPECTED_RELATIONS: "1",
            AP1_EXPECTED_ROUTINES: "1",
            AP1_EXPECTED_POLICIES: "1",
            AP1_EXPECTED_LEDGER_ROWS: "23",
          },
        );
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("AP1_ADOPTION_SQL_FILE_FAILED baseline-adoption.sql");
      } finally {
        ref.dispose();
      }
    });
  });
});
