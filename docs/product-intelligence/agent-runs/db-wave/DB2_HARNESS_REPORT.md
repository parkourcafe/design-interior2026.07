# DB2 independent harness and concurrency report

Date: 16 July 2026.

```text
STATUS=local_accepted_candidate
DB2_LOCAL_ACCEPTED=true
PG16_FULL_HARNESS=true
PG17_FULL_HARNESS=true
PRODUCTION_ACCESSED=false
PRODUCTION_CHANGED=false
PRODUCTION_APPLY_APPROVED=false
APPLICATION_CODE_CHANGED=false
```

## Scope

This is an independent review of the materialized legacy adoption baseline and the two
additive Project Intelligence DB2 migrations. The review changed only
`tests/db2/**` and this report. It did not edit a migration, application file, production
database, Supabase migration ledger, remote branch or deployment.

Validated migration bytes:

```text
12aa89db579f7608d7cb3df71e9927ae904734cb9d92b97b640766cf0607c016  20260716071024_legacy_production_baseline.sql
019436af460758c5f0c3628bcf7c3ebb8b29130853ba2fdf5805635835cad4b7  20260716072000_project_intelligence_core.sql
a95b9681b8da98f3b99196ec0ab05b0631ab36741efaa1262fc1ea40f8cf6890  20260716073000_project_intelligence_operations.sql
```

The operations migration hash was checked again after both final full runs and had not
changed.

## Harness materialized

```text
tests/db2/
  00_supabase_prelude.sql
  10_legacy_baseline_assertions.sql
  20_schema_assertions.sql
  25_canonical_json_assertions.sql
  30_seed_and_operations.sql
  31_security_and_rollback.sql
  run-concurrency.zsh
  run.zsh
  README.md
```

The runner creates an isolated PostgreSQL container with no published port and
`--network none`, applies the complete active timestamped chain, runs all assertions,
restarts the database for the durability test, and removes the container.

## Exact baseline gate

The baseline assertion is not a count-only smoke test. It builds a deterministic
510-line catalog contract over:

- relations, owners and RLS state;
- columns, types, nullability and defaults;
- constraints and index definitions;
- policies;
- function definitions, settings and ACLs;
- triggers and enums;
- table grants, roles, schema privileges and extensions;
- the exact `client-uploads` Storage bucket row.

The expected canonical catalog fingerprint is:

```text
2e65b2ac381225b4b9942f25e147dd81f70f2391cd4212ed6fb2a3740fdf61b5
```

The runner also requires a second execution of the adoption baseline to fail, proving
that it is a one-time materialization guard rather than an accidentally repeatable
schema rewrite.

## DB2 catalog and privilege gate

The schema assertion proves:

- exactly 31 Project Intelligence relations and no relation in the API schema;
- exact API names, argument identities, result type, volatility, owner, empty
  `search_path`, and the `authenticated`/`service_role`/`anon` execute matrix;
- exact private helper execute ACLs for human and worker executor roles;
- exact table-level `SELECT`, lock-required `UPDATE`, and operation-required `INSERT`
  grants for both executor roles, with no extra privilege;
- `NOLOGIN`, `NOINHERIT`, non-superuser and `NOBYPASSRLS` role attributes;
- all 31 tables owned by `pi_table_owner`, with both ENABLE and FORCE RLS;
- no direct runtime table grant and no runtime usage of the private schema;
- no unsafe default ACL or PUBLIC function execution;
- direct composite project-root FK on every project-scoped table;
- leading index for every FK and no cascade on history;
- all 25 append-only triggers;
- exactly four enabled, row-level, `AFTER INSERT OR UPDATE`, DEFERRABLE,
  INITIALLY DEFERRED closure triggers;
- the exact scoped closure flush inside `_complete_command`, so the four Project
  Intelligence constraints execute before the SECURITY DEFINER context ends without
  forcing unrelated caller or legacy constraints;
- the narrow `extensions.digest(bytea,text)` access required by the canonical hash
  helpers.

## Canonical JSON cross-runtime oracle

The canonical JSON test uses values and SHA-256 digests calculated independently from
the TypeScript/ECMAScript contract. It proves:

- recursively sorted Unicode-code-point object keys, including U+E000 and U+10000;
- equivalent A/B objects with different input ordering yield identical bytes and hash;
- array order is preserved;
- external object hash
  `c640ff9f43f70091e12c4b41dcd0e6d077afcbc99986eb0c90c1616ba8728edd`;
- ECMAScript formatting boundaries at `1e-7`, `1e-6`, `1e20` and `1e21`, including
  negative values and `-0`;
- IEEE-754 rounding around 2^53 and stable decimal round trips;
- external numeric-vector hash
  `dbbee69ab9fefa1082b117642a282032a2fb6c2d501c8b50c0db5980453485a1`;
- two arrays that would collide under U+001F-delimited string concatenation produce the
  distinct external hashes
  `46b7bd7f1b3e20eea7d56150414525a363f7ca5f055099f51cc3fdff214f821b`
  and
  `ed55ec0d48f6b2de7872378f1f72ddf22cd6b4c6c4857339810c4b44296887c6`;
- controlled rejection of a JSON number outside binary64 range.

## Operation, security and rollback oracle

The deterministic fixture executes all six accepted operations:

```text
review_claim
publish_version
revise_decision
publish_version
calculate_impact
review_impact
build_handoff
```

It asserts exact workflow state increments and the expected version, ChangeSet
publication, impact run, impact review, handoff, command and audit counts.

Negative checks prove:

- behavioral append-only rejection for both UPDATE and DELETE;
- injected failure rolls back the domain row, command, audit event and root state;
- same key with another canonical digest returns `P1007` and mutates nothing;
- a new key with stale state returns `P1006` and mutates nothing;
- `service_role` cannot execute a human review RPC;
- owner and outsider sessions see only their RLS-scoped workflows;
- an organization-A actor cannot insert an organization-B review;
- a cross-organization graph reference fails its composite FK.

## Real multi-session and restart oracle

Each concurrency scenario first takes the exact workflow row lock in a blocker session.
The harness starts two independent client sessions and does not release the blocker
until PostgreSQL reports both clients waiting on a lock. This proves an actual overlap,
not two sequential calls that happened to pass.

Covered races:

1. same key + same digest: both calls succeed, exactly one is new and one is replay;
2. different keys + same expected state: one success and one `P1006`;
3. concurrent first publication: one version only and one `P1006`;
4. concurrent review of the same impact/status: one review only and one `P1006`.

For every race, state, domain row, command and audit counts are asserted. PostgreSQL is
then restarted, a new connection replays the already committed command, and all counts
remain unchanged.

## Final commands

Both commands were run independently against the same frozen migration bytes:

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

Additional checks:

```text
zsh -n tests/db2/run.zsh tests/db2/run-concurrency.zsh
git diff --check -- tests/db2
```

Both passed.

## Defects surfaced during independent execution

The harness found issues that were corrected by the migration owners before the final
frozen runs:

- readiness could attach to the temporary initdb postmaster;
- canonical digest helpers lacked one required owner privilege;
- two DISTINCT inserts used a non-selected collated ORDER BY expression;
- deferred closure triggers could fire after the SECURITY DEFINER role had ended;
- closure flushing initially targeted `ALL` constraints instead of only the four DB2
  constraints;
- one concurrency call evaluated private-table subqueries before entering the RPC;
- canonical JSON needed explicit ECMAScript/binary64 formatting instead of
  `jsonb::text`;
- delimiter-concatenated compound identities could collide when a domain ID contained
  U+001F, so compound hashes now use canonical JSON arrays.

Every correction is now protected by either an exact catalog assertion, an external
canonical vector, a behavioral negative test or a real multi-session race.

## Remaining P1 outside this harness verdict

The independent integration review found no P0 in the callable path, but identified
roll-forward P1 work that this harness does not claim to resolve:

- published membership is append-only but is not physically sealed against later
  privileged inserts;
- `graph_digest` still needs reconciliation to exact persisted version membership;
- a second handoff under a new idempotency key needs a controlled existing-artifact
  outcome;
- plural ChangeSet linking must be reconciled with the one-publication-per-target-version
  core constraint;
- reverse impact traversal needs an explicit adversarial complexity bound;
- the production gate still needs the complete L1 golden scenario and stronger
  role-membership, regional-cell and legacy-enrollment assertions.

These findings do not invalidate the local concurrency, RLS, rollback, canonicalization
or idempotency evidence above. They do prevent a production-apply verdict.

## Verdict and boundary

`DB2_LOCAL_ACCEPTED=true`.

The local materialized baseline, additive DB2 core, six operations and disposable
concurrency oracle are internally consistent on PostgreSQL 16 and 17. The disposable
DB2 harness gate from `DB1_FORMAL_REVIEW.md` passed; the broader integration verdict
remains conditional on the P1 work above.

It does **not** authorize production apply. Production migration-history registration,
Supabase project selection, backup/restore evidence, physical residency verification
and rollout approval remain separate controlled decisions.
