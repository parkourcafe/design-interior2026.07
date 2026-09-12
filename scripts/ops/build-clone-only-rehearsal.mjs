import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CLONE_REF = "reitdpzxtnmdkznesffu";
const BASELINE_VERSION = "20260716071024";
const OWNER_COMMAND = "Для временного clone reitdpzxtnmdkznesffu разрешаю выполнить безопасную rehearsal-миграцию";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fail = (code) => { throw new Error(code); };

export function buildCloneOnlyRehearsal({ manifest, ownerCommand }) {
  if (manifest?.contract !== "remhaos-adoption-rehearsal-manifest/1.0") fail("CLONE_REHEARSAL_MANIFEST_INVALID");
  if (manifest?.target?.projectRef !== CLONE_REF) fail("CLONE_REHEARSAL_TARGET_REF_FORBIDDEN");
  if (manifest?.executionAuthorized !== false || manifest?.source?.migrationCount !== 98) fail("CLONE_REHEARSAL_MANIFEST_UNSAFE");
  if (hash(ownerCommand) !== hash(OWNER_COMMAND)) fail("CLONE_REHEARSAL_OWNER_COMMAND_MISMATCH");
  const baseline = [
    "begin;",
    "do $$ begin",
    "  if (select count(*) from supabase_migrations.schema_migrations) <> 23 then raise exception 'CLONE_REHEARSAL_HISTORY_COUNT_MISMATCH'; end if;",
    `  if exists (select 1 from supabase_migrations.schema_migrations where version = '${BASELINE_VERSION}') then raise exception 'CLONE_REHEARSAL_BASELINE_ALREADY_PRESENT'; end if;`,
    "end $$;",
    `insert into supabase_migrations.schema_migrations (version, name) values ('${BASELINE_VERSION}', 'legacy_production_baseline');`,
    "commit;",
  ].join("\n");
  return { contract: "remhaos-clone-rehearsal/1.0", targetRef: CLONE_REF, ownerCommandSha256: hash(ownerCommand), manifestSha256: hash(JSON.stringify(manifest)), baselineHistoryRepairSql: baseline, migrations: manifest.source.migrations.slice(1), stopOnFirstError: true, resumeAllowed: false };
}

if (process.argv[1] === import.meta.filename) {
  const [manifestPath, outputPath] = process.argv.slice(2);
  if (!manifestPath || !outputPath) fail("CLONE_REHEARSAL_USAGE");
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  const receipt = buildCloneOnlyRehearsal({ manifest, ownerCommand: OWNER_COMMAND });
  writeFileSync(resolve(outputPath), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
}
