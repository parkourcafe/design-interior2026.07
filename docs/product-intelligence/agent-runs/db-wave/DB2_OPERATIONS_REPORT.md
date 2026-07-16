# DB2 operations migration report

Date: 16 July 2026.

```text
STATUS=accepted_candidate
DATABASE_CHANGED=false
PRODUCTION_ACCESSED=false
LEGACY_PUBLIC_TABLES_CHANGED=false
APPLICATION_CODE_CHANGED=false
DISPOSABLE_DATABASES_ONLY=true
```

## Scope

This report covers only the six Project Intelligence L1 database mutations:

- `review_claim`;
- `publish_version`;
- `revise_decision`;
- `calculate_impact`;
- `review_impact`;
- `build_handoff`.

The implementation target is
`supabase/migrations/20260716073000_project_intelligence_operations.sql`. It depends on
the exact interface materialized by
`20260716072000_project_intelligence_core.sql`; no legacy `public` table is extended or
rewritten.

## Frozen transaction contract

Every operation uses the same project-level serialization boundary:

```text
project_workflows root row
-> operation-specific entity rows in stable ID order
-> scoped command record
-> append-only audit event
```

For a new successful command, domain records, the stored logical result, command record,
audit event and one `state_revision` increment are committed in one PostgreSQL
transaction. Rejected commands leave all of them unchanged.

Idempotency scope is
`(organization_id, project_id, operation, sha256(idempotency_key))`. Request digests are
computed in PostgreSQL from the normalized business command. The key, actor metadata,
server time and request ID are not accepted as mutable business data. Replay is resolved
before stale-state validation, but only after the current caller has been reauthorized.

```text
same key digest + same request digest      -> stored logical result, replay=true
same key digest + different request digest -> controlled IDEMPOTENCY_CONFLICT
new key + stale expected state             -> controlled STATE_STALE
```

## Actor and privilege contract

- Human functions derive the user exclusively from `auth.uid()` and require active
  organization membership plus the operation capability on every call and replay.
- `calculate_impact` and `build_handoff` are worker operations. Their functions are
  executable only by `service_role`, but execute as a dedicated `NOLOGIN`,
  `NOBYPASSRLS` definer.
- All security-definer functions use `search_path=''` and schema-qualified objects.
- `anon`, `PUBLIC` and runtime roles receive no direct table access through this
  migration.
- No raw bearer token, caller-supplied actor, changed root, impacted list or graph edge is
  accepted.

## Stable error contract

The SQL API uses controlled five-character SQLSTATE values and stable message codes:

| SQLSTATE | Stable message |
|---|---|
| `P1001` | `ACCESS_DENIED` |
| `P1002` | `PROJECT_NOT_FOUND` |
| `P1003` | `PROJECT_SCOPE_VIOLATION` |
| `P1004` | `REVISION_STALE` |
| `P1005` | `VERSION_STALE` |
| `P1006` | `STATE_STALE` |
| `P1007` | `IDEMPOTENCY_CONFLICT` |
| `P1008` | `INVALID_TRANSITION` |
| `P1009` | `CHANGE_REASON_REQUIRED` |
| `P1010` | `EVIDENCE_ACK_REQUIRED` |
| `P1011` | `DOMAIN_CONTRACT_VIOLATION` |
| `P1012` | `IMPACT_STALE` |

Machine-readable context is returned only through controlled `DETAIL` JSON. Free-text
change reasons and source content are never copied to errors or audit metadata.

## Implemented narrow SQL surface

The callable schema is function-only: `project_intelligence_api`. Organization, actor,
time, request ID, roots, paths and edges are deliberately absent from the parameters.

```text
review_claim(
  project_id uuid,
  target_revision_id text,
  expected_revision_id text,
  expected_state_revision bigint,
  decision text,
  idempotency_key text
) -> jsonb

publish_version(
  project_id uuid,
  expected_latest_version_id text,
  expected_state_revision bigint,
  label text,
  selected_revisions jsonb,
  idempotency_key text
) -> jsonb

revise_decision(
  project_id uuid,
  node_id text,
  base_version_id text,
  expected_revision_id text,
  expected_state_revision bigint,
  title text,
  payload jsonb,
  reason_code text,
  protected_reason text,
  idempotency_key text
) -> jsonb

calculate_impact(
  project_id uuid,
  change_set_id text,
  expected_state_revision bigint,
  idempotency_key text
) -> jsonb

review_impact(
  project_id uuid,
  impact_run_id text,
  impact_id text,
  expected_impact_status text,
  disposition text,
  reason_code text,
  expected_state_revision bigint,
  idempotency_key text
) -> jsonb

build_handoff(
  project_id uuid,
  impact_run_id text,
  expected_state_revision bigint,
  idempotency_key text
) -> jsonb
```

`publish_version.selected_revisions` may only select server-stored current revisions and
is normalized by node/revision ID before hashing. `calculate_impact` derives the version
diff, changed roots, reverse-dependency paths and impacts from exact stored snapshots.
`build_handoff` derives the target version, exact run, review chain and graph content from
stored records. Consequently neither worker command accepts an impact result or handoff
payload from its caller.

Every response has one stable envelope:

```json
{
  "operation": "review_claim",
  "replay": false,
  "stateRevision": 1,
  "result": {}
}
```

The stored `logical_result` is returned unchanged on replay; only `replay` changes.

## Operation-specific persistence rules

### `review_claim`

- lock the current target node/revision after the workflow root;
- require a human actor and `review_claim` capability;
- require `target_revision_id = expected_revision_id = node.current_revision_id`;
- append one exact human review and return its effective status;
- never alter the reviewed revision or published snapshots.

### `publish_version`

- require the exact current latest version and current project state;
- validate every explicit selection against the current stable node/revision;
- reject unconfirmed AI-origin decision/requirement revisions;
- allocate `version_no = latest + 1` under the workflow lock;
- persist exact normalized node, revision, review, source, fragment, evidence and edge
  membership;
- bind matching pending ChangeSets to the new version without rewriting their protected
  reason;
- update `latest_version_id` in the same single root state increment.

### `revise_decision`

- require a human actor and `revise_decision` capability;
- require controlled reason code plus non-empty protected reason;
- lock the stable decision node/current revision in ID order;
- require the exact latest base version and its exact selected revision;
- reject a no-op JSONB payload;
- append a human-origin revision, exact confirming review, protected reason and pending
  ChangeSet; only the stable node's current revision pointer changes.

### `calculate_impact`

- worker-only; derive the finalized ChangeSet and immediate from/to version pair;
- derive changed nodes by comparing exact version memberships;
- traverse only `depends_on`, `derived_from`, `specified_by`, `satisfies` in reverse
  dependency direction;
- choose the shortest deterministic path per changed-root/impacted-node pair and reject
  caller-supplied roots or paths;
- persist the immutable run, algorithm descriptor, target graph digest, result digest,
  changes, impacts and exact path steps.

### `review_impact`

- require a human actor and `review_change_impact` capability;
- lock the exact run, impact and current review chain after the workflow root;
- derive current status from append-only reviews;
- permit `needs_review -> accepted|resolved|dismissed` and
  `accepted -> resolved|dismissed`; terminal or stale transitions raise `IMPACT_STALE`;
- append one review without updating the immutable impact/run.

### `build_handoff`

- worker-only; require the exact stored run, target version and complete review chain;
- reject any impact still at `needs_review`;
- derive logical JSON from exact version membership, provenance, sources and latest impact
  dispositions;
- store immutable logical content plus a SHA-256 semantic content digest; no renderer,
  signed URL, object-storage write or external call occurs in the transaction.

The digest input is not PostgreSQL `jsonb::text`. The migration implements recursive
canonical JSON compatible with the application contract: Unicode-code-point object-key
ordering, preserved array order, no insignificant whitespace, JSON string escaping and
ECMAScript binary64 number formatting. This removes PostgreSQL's native JSONB key-order
and whitespace differences from semantic hashes.

## Closure validation

The four deferred Project Intelligence closure constraints are forced `IMMEDIATE` before
the security-definer RPC returns, while the relevant NOLOGIN executor is still the
effective role:

- `graph_node_revisions_evidence_closure`;
- `project_versions_closure`;
- `change_set_publications_closure`;
- `impacts_path_closure`.

They are then restored to `DEFERRED`. No unrelated caller or legacy constraint is forced.
Any closure failure rolls back domain rows, command, audit and state increment together.

## Disposable test oracle

The migration is not acceptable until a disposable PostgreSQL/Supabase-equivalent test
proves all of the following:

1. two parallel same-key/same-digest calls return one new success and one replay, one
   audit row and one state increment;
2. the same key with another digest returns `P1007` and changes nothing;
3. two different keys with the same expected state produce one success and one `P1006`;
4. concurrent publications allocate one version only;
5. concurrent impact reviews of the same expected status produce one review only;
6. an injected failure after domain inserts but before completion rolls back domain,
   command, audit and state changes;
7. unrelated organization members cannot read or mutate through RLS or a composite FK;
8. AI/system identities cannot execute human review operations;
9. history `UPDATE`/`DELETE` is rejected;
10. a committed result replays after a new database connection;
11. `anon` has no schema/function/table access, `authenticated` has only the three human
    plus impact-review functions, and `service_role` has only the two worker functions;
12. function owners are `NOLOGIN`, `NOBYPASSRLS`, use `search_path=''`, and all tenant
    tables remain `ENABLE/FORCE RLS`.

## Validation results

Executed from a clean disposable container:

```text
PI_DB_IMAGE=postgres:17-alpine tests/db2/run.zsh
DB2_SCHEMA_ASSERTIONS_OK
DB2_CANONICAL_JSON_ASSERTIONS_OK
DB2_SEED_AND_SEQUENTIAL_OPERATIONS_OK
DB2_SECURITY_ROLLBACK_AND_ISOLATION_OK
DB2_CONCURRENCY_AND_RESTART_OK
DB2_HARNESS_OK image=postgres:17-alpine

PI_DB_IMAGE=postgres:16-alpine tests/db2/run.zsh
DB2_SCHEMA_ASSERTIONS_OK
DB2_CANONICAL_JSON_ASSERTIONS_OK
DB2_SEED_AND_SEQUENTIAL_OPERATIONS_OK
DB2_SECURITY_ROLLBACK_AND_ISOLATION_OK
DB2_CONCURRENCY_AND_RESTART_OK
DB2_HARNESS_OK image=postgres:16-alpine
```

This proves the twelve disposable-oracle requirements above, including same-key replay,
different-digest conflict, stale CAS, publication and review races, injected rollback,
cross-organization isolation, append-only enforcement, restart-safe replay and exact
function/schema privileges.

## Core reconciliation

Complete against `project-intelligence-db2-core/1.0` and the materialized
`20260716072000_project_intelligence_core.sql`. The operations migration uses the exact
31-relation interface, composite keys, audit metadata allowlists and role names from that
DDL.

The API ownership handoff temporarily grants executor roles `CREATE` on
`project_intelligence_api`, transfers the four human functions to
`pi_human_executor` and the two worker functions to `pi_worker_executor`, then revokes
`CREATE` before commit. `authenticated` receives only API schema usage plus the four
human functions; `service_role` receives only usage plus the two worker functions;
`anon` and `PUBLIC` receive neither.

## Remaining P1 before production

Independent integration review accepted the local callable path conditionally and found
no P0, but production remains closed until these design/test debts are resolved:

- published membership is append-only but is not yet physically sealed against later
  privileged inserts;
- `graph_digest` must be reconciled to the exact persisted version membership rather
  than a broader current-graph projection;
- a second handoff command with a new key needs a controlled existing-artifact outcome
  instead of relying on the semantic unique constraint;
- the plural ChangeSet linking behavior must be reconciled with the core constraint that
  currently permits one publication binding per target version;
- reverse traversal needs an explicit complexity bound for adversarial dense/cyclic
  graphs;
- production-gate coverage still needs the complete L1 golden scenario plus stronger
  role-membership, regional-cell and legacy-enrollment assertions.

These are roll-forward P1 items. They do not invalidate the disposable local concurrency,
RLS, rollback or idempotency evidence, and they do block a production apply claim.

No production connection or credential was used. This report is a local acceptance
candidate, not production apply approval.
