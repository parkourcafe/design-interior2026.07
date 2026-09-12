import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CLONE_REF = "reitdpzxtnmdkznesffu";
const BASELINE_VERSION = "20260716071024";
const LEDGER_PATH = "tests/ap1/environment/migration-ledger.sha256";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw new Error(code); };

function verifiedLedger(repository) {
  return readFileSync(resolve(repository, LEDGER_PATH), "utf8").trim().split("\n").map((line) => {
    const match = /^([a-f0-9]{64})  (supabase\/migrations\/(\d{14})_[^\s]+\.sql)$/.exec(line);
    if (!match) fail("CLONE_REHEARSAL_LEDGER_INVALID");
    const bytes = readFileSync(resolve(repository, match[2]));
    if (hash(bytes) !== match[1]) fail("CLONE_REHEARSAL_MIGRATION_DIGEST_MISMATCH");
    return { sha256: match[1], path: match[2], version: match[3] };
  });
}

export function buildCloneOnlyRehearsal({ manifest, ownerCommand, repository }) {
  if (manifest?.contract !== "remhaos-adoption-rehearsal-manifest/1.0") fail("CLONE_REHEARSAL_MANIFEST_INVALID");
  if (manifest?.target?.projectRef !== CLONE_REF) fail("CLONE_REHEARSAL_TARGET_REF_FORBIDDEN");
  const ledger = verifiedLedger(repository);
  if (manifest?.executionAuthorized !== false || manifest?.source?.migrationCount !== 98 || ledger.length !== 98) fail("CLONE_REHEARSAL_MANIFEST_UNSAFE");
  if (JSON.stringify(manifest.source.migrations) !== JSON.stringify(ledger)) fail("CLONE_REHEARSAL_MANIFEST_LEDGER_MISMATCH");
  if (typeof ownerCommand !== "string" || !ownerCommand.trim()) fail("CLONE_REHEARSAL_OWNER_COMMAND_REQUIRED");
  const baseline = [
    "begin;",
    "do $$ begin",
    "  if (select count(*) from supabase_migrations.schema_migrations) <> 23 then raise exception 'CLONE_REHEARSAL_HISTORY_COUNT_MISMATCH'; end if;",
    `  if exists (select 1 from supabase_migrations.schema_migrations where version = '${BASELINE_VERSION}') then raise exception 'CLONE_REHEARSAL_BASELINE_ALREADY_PRESENT'; end if;`,
    "end $$;",
    `insert into supabase_migrations.schema_migrations (version, name) values ('${BASELINE_VERSION}', 'legacy_production_baseline');`,
    "commit;",
  ].join("\n");
  return { contract: "remhaos-clone-rehearsal/1.0", targetRef: CLONE_REF, ownerCommandSha256: hash(ownerCommand), manifestSha256: hash(JSON.stringify(manifest)), executionAuthority: "agent-thread-only", baselineHistoryRepairSql: baseline, migrations: ledger.slice(1), stopOnFirstError: true, resumeAllowed: false };
}

if (process.argv[1] === import.meta.filename) {
  const [manifestPath, outputPath] = process.argv.slice(2);
  if (!manifestPath || !outputPath) fail("CLONE_REHEARSAL_USAGE");
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  const receipt = buildCloneOnlyRehearsal({ manifest, ownerCommand: process.env.CLONE_REHEARSAL_OWNER_COMMAND ?? "", repository: resolve(import.meta.dirname, "../..") });
  writeFileSync(resolve(outputPath), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}
