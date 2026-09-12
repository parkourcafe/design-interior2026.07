import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const CONTRACT = "remhaos-adoption-rehearsal-manifest/1.0";
const SNAPSHOT_CONTRACT = "remhaos-production-catalog/2.0";
const LEDGER = "tests/ap1/environment/migration-ledger.sha256";
const AUXILIARY_INPUTS = [
  "supabase/roles.sql",
  "tests/ap1/environment/verify-db.sql",
  "tests/ap1/environment/apply-hosted-role-precondition.sql",
];

function fail(code) { throw new Error(code); }
function sha256(bytes) { return createHash("sha256").update(bytes).digest("hex"); }

export function parseLedger(text) {
  const entries = text.trim().split("\n").map((line) => {
    const match = /^([a-f0-9]{64})  (supabase\/migrations\/(\d{14})_[^\s]+\.sql)$/.exec(line);
    if (!match) fail("ADOPTION_MANIFEST_LEDGER_INVALID");
    return { sha256: match[1], path: match[2], version: match[3] };
  });
  if (entries.length !== 98 || new Set(entries.map((entry) => entry.version)).size !== entries.length) {
    fail("ADOPTION_MANIFEST_LEDGER_NOT_CURRENT");
  }
  return entries;
}

export function buildManifest({ repository, targetRef, snapshotBytes, now = new Date().toISOString() }) {
  if (!/^[a-z0-9]{20}$/.test(targetRef)) fail("ADOPTION_MANIFEST_TARGET_REF_INVALID");
  let snapshot;
  try { snapshot = JSON.parse(snapshotBytes.toString("utf8")); } catch { fail("ADOPTION_MANIFEST_SNAPSHOT_INVALID"); }
  if (snapshot.snapshot_contract !== SNAPSHOT_CONTRACT || snapshot.database !== "postgres" || !Array.isArray(snapshot.migration_ledger)) {
    fail("ADOPTION_MANIFEST_SNAPSHOT_CONTRACT_INVALID");
  }
  if (snapshot.migration_ledger.length !== 23) fail("ADOPTION_MANIFEST_SNAPSHOT_HISTORY_INVALID");
  const ledgerBytes = readFileSync(resolve(repository, LEDGER));
  const ledger = parseLedger(ledgerBytes.toString("utf8"));
  for (const entry of ledger) {
    const bytes = readFileSync(resolve(repository, entry.path));
    if (sha256(bytes) !== entry.sha256) fail("ADOPTION_MANIFEST_MIGRATION_DIGEST_MISMATCH");
  }
  const auxiliary = Object.fromEntries(AUXILIARY_INPUTS.map((path) => [path, sha256(readFileSync(resolve(repository, path)))]));
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repository, encoding: "utf8" }).trim();
  return {
    contract: CONTRACT,
    status: "REVIEW_REQUIRED",
    executionAuthorized: false,
    createdAt: now,
    target: { projectRef: targetRef, database: "postgres" },
    source: { commit: sourceCommit, ledgerPath: LEDGER, ledgerSha256: sha256(ledgerBytes), migrationCount: ledger.length, migrations: ledger },
    preconditions: {
      snapshotSha256: sha256(snapshotBytes), snapshotCapturedAt: snapshot.captured_at, legacyHistoryCount: 23, auxiliary,
      baselineHistoryRepair: { status: "SEPARATE_ARTIFACT_REQUIRED", executionAuthorized: false },
    },
  };
}

function main(args) {
  if (args.length !== 6 || args[0] !== "--snapshot" || args[2] !== "--target-ref" || args[4] !== "--out") fail("ADOPTION_MANIFEST_USAGE");
  const repository = resolve(import.meta.dirname, "../..");
  const manifest = buildManifest({ repository, targetRef: args[3], snapshotBytes: readFileSync(resolve(args[1])) });
  const output = resolve(args[5]);
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const temporary = `${output}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, output);
}

if (process.argv[1] === import.meta.filename) main(process.argv.slice(2));
