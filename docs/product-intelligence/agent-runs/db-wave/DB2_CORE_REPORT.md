# DB2 core migration report

Date: 16 July 2026.

```text
STATUS=core_structural_pass
CORE_TABLE_COUNT=31
PG17_CLEAN_BOOTSTRAP=true
DB2_FULL_HARNESS_CLAIMED=false
DATABASE_CHANGED=false
PRODUCTION_ACCESSED=false
LEGACY_PUBLIC_TABLES_CHANGED=false
APPLICATION_CODE_CHANGED=false
```

## Scope

Implemented:

`supabase/migrations/20260716072000_project_intelligence_core.sql`

The migration is additive. It creates the accepted private Project Intelligence
persistence boundary and does not backfill or rewrite a legacy application row.

It materializes exactly the 31 relations frozen by
`project-intelligence-db2-core/1.0`:

- tenancy and enrollment: 5;
- provenance/current graph: 7;
- exact published versions: 7;
- ChangeSet: 3;
- impact: 5;
- logical handoff: 2;
- durable command/audit: 2.

No `draft_edges`, `version_revisions` or `impact_run_roots` relation was added. Their
accepted normalized replacements remain `version_nodes.revision_id`,
`impact_run_changes.impact_relevant`, and append-only `graph_edges` plus
`version_edges`.

## Persistence invariants

The core DDL enforces:

- bounded non-empty domain IDs and JavaScript-safe bigint counters;
- exact 32-byte SHA-256 fields;
- source checksum uniqueness inside one project;
- typed Source locator validation matching the TypeScript locator contract;
- same-node revision replacement lineage;
- deferred current-revision and latest-version FKs;
- deferred evidence requirement for AI `extracted|interpreted` revisions;
- one human review per exact revision;
- exact version membership for node/revision, review, source, fragment, evidence and
  edge identity;
- deferred version closure, including confirmed AI decision/requirement selection,
  evidence/source closure and edge endpoint membership;
- protected ChangeSet reason separated from controlled reason code;
- deferred ChangeSet publication lineage;
- normalized impact changes and paths, with propagating relations only and exact target
  version edge membership;
- append-only impact review transitions;
- exact impact-run/target-version binding for logical handoff;
- durable idempotency uniqueness on
  `(organization_id, project_id, operation, key_digest)`;
- controlled audit event types and event-specific top-level metadata key allowlists.

Every project-scoped relation has a direct
`(organization_id, project_id) -> project_workflows` FK. Child identity FKs are also
composite-scoped. All history FKs use `ON DELETE RESTRICT`.

## Index and immutability contract

- Every core FK has a valid leading index.
- Reverse impact traversal has
  `(organization_id, project_id, to_node_id, relation, from_node_id)`.
- Audit ordering has
  `(organization_id, project_id, occurred_at DESC)`.
- All 25 frozen history/command/audit relations have a
  `BEFORE UPDATE OR DELETE` trigger calling
  `project_intelligence.reject_append_only_mutation()`.
- Immutable tables grant executor roles `UPDATE` only so internal RPCs can take
  `SELECT ... FOR UPDATE` locks; the trigger rejects any actual update or delete.

## Security boundary

Created roles:

```text
pi_table_owner      NOLOGIN, NOINHERIT, NOBYPASSRLS
pi_human_executor   NOLOGIN, NOINHERIT, NOBYPASSRLS
pi_worker_executor  NOLOGIN, NOINHERIT, NOBYPASSRLS
```

The migration refuses unsafe pre-existing role attributes. All 31 tables are owned by
`pi_table_owner`, with both `ENABLE ROW LEVEL SECURITY` and
`FORCE ROW LEVEL SECURITY`.

`PUBLIC`, `anon`, `authenticated` and `service_role` receive:

- no direct table privileges;
- no `project_intelligence` schema usage;
- no execution privilege on private helper functions.

Human executor rows require the current `auth.uid()` to be an active organization
member. Worker policies are available only to the dedicated NOLOGIN worker role; its
actual reach is limited by the two worker-owned SECURITY DEFINER RPCs in the operations
migration. Table grants distinguish human and worker insert/update surfaces.

The API schema contains no relation. Core leaves both executor roles without API-schema
`CREATE`. The operations migration must grant `CREATE` only transiently while
transferring function ownership, then revoke it.

## PG17 verification

Verified on a disposable `postgres:17-alpine` database in this order:

1. `tests/db2/00_supabase_prelude.sql`;
2. `20260716071024_legacy_production_baseline.sql`;
3. `20260716072000_project_intelligence_core.sql`.

Final observed structural result:

```json
{"tables":31,"forced_rls":31,"wrong_owner":0}
{"runtime_core_usage":false,"api_executor_create":false}
```

Independent catalog checks:

```text
missing_fk_indexes=0
missing_root_fk=0
public_core_function_exec=0
unsafe_default_acl=0
runtime_direct_table_grants=0
append_only_triggers=25
history_cascade_fks=0
```

One first-pass syntax defect was found and fixed during the disposable run:

- a generated and explicit check constraint had the same name on
  `impact_path_steps.relation`;

No other core migration failure remained after the rename.

## Deliberate assumptions

- Version numbering starts at `1`; a non-root version must be exactly its base version
  plus one.
- Locator JSON uses the frozen TypeScript camelCase field names and repeats its `kind`,
  which must equal `locator_kind`.
- Capability authorization remains mandatory inside every operations RPC. Core RLS is a
  second boundary; it does not replace per-operation authorization.
- The `ru` deployment-cell seed is a logical classification only and does not assert a
  physical Supabase hosting region.

## Remaining acceptance work

This report claims only the core structural pass. Full DB2 acceptance still requires:

- the six operations RPCs with final owner/grant closure;
- seed/negative RLS tests;
- replay, stale-CAS, publication and impact-review concurrency tests;
- rollback fault injection;
- restart-safe idempotency and full API privilege assertions.

No migration was applied to production and no production migration ledger was changed.
