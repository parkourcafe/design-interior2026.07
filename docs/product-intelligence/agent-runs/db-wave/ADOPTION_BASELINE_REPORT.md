# Production adoption baseline report

Дата: 16 июля 2026 года.

```text
ADOPTION_BASELINE_MATERIALIZED=true
ACTIVE_CHAIN_ROOT=20260716071024_legacy_production_baseline.sql
CLEAN_BOOTSTRAP_PASS=true
PRODUCTION_SCHEMA_CONTRACT_MATCH=true
LEGACY_EVIDENCE_EXACT=true
PRODUCTION_DATABASE_CHANGED=false
PRODUCTION_MIGRATION_LEDGER_CHANGED=false
NETWORK_WRITES=false
FUTURE_PI_MIGRATIONS_TOUCHED=false
GIT_INDEX_OR_REFS_CHANGED=false
```

## Result

The executable migration chain now starts with exactly one clean-bootstrap
adoption root:

```text
supabase/migrations/20260716071024_legacy_production_baseline.sql
```

The baseline directly creates the verified final legacy production schema. It
does not replay historical `ALTER`, backfill or cleanup statements.

Included:

- final effects of `0001_init`;
- nullable `projects.designer_id` from `0002_client_briefs`;
- `projects.custom_questions` from `0003_custom_questions`;
- `designers.profile` from `0004_designer_profile`;
- team table, function and final studio policies from `0006_team`;
- exact schema-equivalent final state of the HEAD `0007_project_rooms` blob;
- private `client-uploads` storage bucket from the original `0001` effect.

Excluded:

- `0005_rate_limits`: absent from production;
- `0008_concept_packs`: absent from production;
- `0009_project_room_workflow`: absent and rejected as unsafe.

## Production safety boundary

The baseline contains an executable precondition guard. If any legacy
application relation already exists in `public`, it raises:

```text
legacy production baseline is clean-bootstrap only; application relations already exist
```

Therefore:

- it is suitable for a clean local, preview or future cell bootstrap;
- it must not be executed over the current production database;
- current production can adopt version `20260716071024` only through an
  explicitly authorized migration-history repair after a final fingerprint
  check;
- old numeric versions `0001`–`0009` must not be marked individually as
  applied.

No production command, SQL, migration repair, link, push or ledger mutation was
performed in this task.

## Legacy evidence

Exact historical bytes are preserved as non-executable `.sql.txt` files:

```text
docs/product-intelligence/agent-runs/db-wave/legacy-migrations/
```

`manifest.json` records each file's source, production status, byte count and
SHA-256. Important identities:

```text
0007 evidence SHA-256:
474f49491d60bbb200f8f1723a500b3f2c3b7fe0c4769d5507544c07e73a12cc

0007 Git blob:
a13a3c4b5024e14f5cd80883e83c4b1ce5353fc9

rejected 0009 SHA-256:
3b6c8623aaa758336434435ddb00cde52f8ab9f223780cfd95080a0491bcaf26

adoption baseline SHA-256:
12aa89db579f7608d7cb3df71e9927ae904734cb9d92b97b640766cf0607c016
```

All nine evidence files match the manifest. The `0007` evidence also compares
byte-for-byte with:

```text
git show HEAD:supabase/migrations/0007_project_rooms.sql
```

## Local verification

The baseline was executed in disposable local PostgreSQL 16 and PostgreSQL 17
containers with minimal Supabase-compatible prerequisites. The PostgreSQL 17 image
matches the production major and was pinned by digest:

```text
postgres:17-alpine
sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193
```

Prerequisites:

- roles `anon`, `authenticated`, `service_role`;
- `auth.users`;
- `auth.uid()`;
- `storage.buckets`.

Execution completed atomically:

```text
BEGIN ... COMMIT
```

Result:

| Contract object | Production | Clean bootstrap |
|---|---:|---:|
| public relations | 11 | 11 |
| columns | 90 | 90 |
| constraints | 52 | 52 |
| indexes | 31 | 31 |
| policies | 16 | 16 |
| functions | 1 | 1 |
| triggers | 0 | 0 |
| enums | 0 | 0 |
| role table grants | 308 | 308 |

The normalized contract projection includes relations, columns, constraints,
indexes, policies, function definition and ACL, triggers, enums and grants. Its
SHA-256 is identical for the production snapshot and local bootstrap:

```text
ac64fa6599ed4d4e9ff1ceb53aedfb2639a969faaf430b8cc20c149312da93c1
```

The projection excludes environment-only metadata, migration ledger, platform
roles/extensions, schema ACL and relation ACL text. Full diff showed only one
expected server-version difference: PostgreSQL 16 lacks the PostgreSQL 17
`MAINTAIN` ACL letter `m`. The baseline uses `GRANT ALL PRIVILEGES`, so
PostgreSQL 17 will include `MAINTAIN`, matching production.

Storage verification in the clean bootstrap:

```text
client-uploads | client-uploads | public=false
```

Production Storage was also verified read-only through the Storage API:

```text
bucket:                 client-uploads
public:                 false
created_at:             2026-07-02
updated_at:             2026-07-02
file_size_limit:        null
allowed_mime_types:     null
```

A second execution on PostgreSQL 17 was intentionally attempted and correctly rejected
by the clean-bootstrap guard before any DDL.

## Preserved legacy security debt

The adoption root reproduces rather than hides the observed legacy contract:

- broad table grants to `anon`, `authenticated` and `service_role`, relying on
  RLS for row isolation;
- RLS enabled but not forced;
- permissive studio policies, including several `FOR ALL` policies;
- `is_studio_member` as `SECURITY DEFINER` with `search_path=public` and public
  execute;
- raw participant access tokens;
- mutable and cascade-deleted legacy event history.

These patterns are explicitly documented in the SQL header. Future Project
Intelligence migrations must use the accepted private-schema, least-privilege,
forced-RLS and append-only contracts instead of copying legacy behavior.

## Remaining production-adoption checks

The public-schema fingerprint, production Storage bucket and local release
artifact are verified. The only remaining blocker is explicit production
approval for ledger-only adoption.

After that approval:

1. Mark only version `20260716071024` as applied using the supported Supabase
   migration repair workflow.
2. Re-read the ledger and verify that no SQL from the clean-bootstrap baseline
   executed against existing production.

No production repair or ledger mutation was performed here.
