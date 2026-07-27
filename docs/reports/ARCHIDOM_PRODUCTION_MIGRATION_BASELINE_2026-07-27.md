# ArchiDom Production Migration Baseline — 27.07.2026

## Status

- `LOCAL_BASELINE_REPLAY: RECONCILED`
- `PRODUCTION_MIGRATION_LEDGER: NOT_RECONCILED`
- `SAFE_TO_RETRY_PRODUCTION_MIGRATIONS: NO`

No production DDL, migration-history repair, branch merge, reset or migration
retry was executed.

## Production evidence

Production project: `ztnycrchwxqczqbyegnp`.

The production migration ledger contains one entry:

| Version | Name | Statements |
|---|---|---:|
| `20260719020040` | `remote_schema` | 182 |

The repository contains:

- `0001`–`0006`: legacy M1 schema and compatibility changes;
- `0007`–`0009`: Sprint 1 platform foundation;
- six timestamped corrective migrations from `20260727111743` through
  `20260727220000`.

Before this reconciliation change, the repository did not contain
`supabase/migrations/20260719020040_remote_schema.sql`.

Production already contains the effective legacy objects from `0001`–`0006`:

- `designers`, `projects`, `answers`, `risk_cards`, `proposals`, `events`,
  `rate_limits`, `studio_members`;
- the expected columns, indexes and RLS policies;
- `public.is_studio_member`;
- RLS enabled on all eight tables.

Production also contains legacy objects captured only by `remote_schema`,
including `project_rooms`, `project_participants`, `project_tasks` and
`project_task_events`.

Production does not contain the Sprint 1 foundation tables:

- `project_sources`;
- `project_facts`;
- `workflow_definitions`;
- `workflow_runs`;
- `workflow_step_runs`;
- `approval_requests`;
- `audit_events`;
- `ai_calls`.

Therefore the failed deployment did not partially apply Sprint 1 migrations.

## Root cause

There are two independent baseline conflicts.

### 1. Migration-ledger conflict

The latest production migration version is `20260719020040`, while the
repository introduces unrecorded migrations `0001`–`0009` before that version.
The repository is also missing the production ledger's snapshot migration.
The migration graph therefore cannot be reconciled by version alone.

### 2. Schema-replay conflict

The objects and policies created by `0001`–`0006` already exist in production
because they were captured by `remote_schema`. Forcing those migrations to run
would not be safe. Although some tables use `create table if not exists`, policy
creation and other DDL are not universally idempotent. Production already has,
for example, every expected `0006` studio policy.

The observed `MIGRATIONS_FAILED` state is therefore consistent with the
history mismatch. Even if the history check were bypassed, a forced replay of
`0001`–`0006` would risk duplicate-object failures.

## Unsafe actions — do not run

- Do not use `supabase db reset --linked`.
- Do not force all local migrations into production.
- Do not delete or rewrite `20260719020040_remote_schema` in production history.
- Do not mark `0007+` as applied: their tables are absent.
- Do not copy the 182-statement snapshot into the active migration chain without
  first proving an empty-database replay. It overlaps `0001`–`0006`.

## Controlled reconciliation plan

### Gate A — capture and classify the production snapshot

1. Export the exact `20260719020040_remote_schema` statements to a read-only
   evidence artifact outside the active migration directory.
2. Produce an object-level diff:
   - covered by `0001`–`0006`;
   - production-only compatibility objects;
   - Supabase-managed objects that must not be replayed by the application.
3. Create an additive compatibility migration for production-only application
   objects so a clean database can be reconstructed without replaying the
   overlapping snapshot.

Gate A is complete in this branch:

- the exact production snapshot is archived at
  `docs/baselines/20260719020040_remote_schema.production.sql`;
- `supabase/migrations/20260719020040_remote_schema.sql` is a comment-only
  ledger marker and does not replay overlapping production DDL;
- `supabase/migrations/20260719021000_remote_schema_compatibility_bridge.sql`
  additively reconstructs the four production-only application tables,
  their indexes, RLS policies and legacy status values.

### Gate B — prove clean replay

1. Add a repository history marker for `20260719020040` only after the overlap
   strategy is reviewed.
2. Run `supabase db reset --local --no-seed` from an empty local database.
3. Verify migrations `0001` through `20260727220000`, RLS, functions, grants and
   required compatibility objects.
4. Repeat on a disposable Supabase branch and run authenticated negatives plus
   the M1 workflow.

The empty local database portion of Gate B passed on 28.07.2026:

- a first clean initialization applied every migration from `0001` through
  `20260727220000`; the subsequent optional Vector container startup failed
  because of a local Colima socket mount, after SQL replay had completed;
- a second clean initialization with only the optional Vector service excluded
  again applied all 17 migrations and started successfully;
- `supabase migration list --local` reported identical local and database
  versions for all 17 entries;
- all 12 checked platform and compatibility tables had RLS enabled;
- all four compatibility policies were present;
- legacy project and proposal status constraints included the production-only
  values;
- `supabase db lint --local --level warning --fail-on error` returned no errors.

The lint run retained one non-blocking warning in the pre-existing
`public.finalize_m1_risk_rerun` function: variable `v_ai_call` is never read.

The disposable Supabase branch portion of Gate B also passed on 28.07.2026:

- PR #52 automatically created disposable preview
  `wmqjmbjrqcwqllmsmgoj`;
- the preview reached `FUNCTIONS_DEPLOYED` / `ACTIVE_HEALTHY`;
- its migration ledger contained the same 17 versions from `0001` through
  `20260727220000`;
- all 12 checked platform and compatibility tables had RLS enabled;
- all four compatibility policies and both extended status constraints were
  present.

The Supabase security advisor reported existing review items rather than a
baseline replay failure:

- `rate_limits` has RLS enabled without a policy (`INFO`);
- several existing `SECURITY DEFINER` workflow RPCs remain executable by the
  `authenticated` role (`WARN`) and must retain explicit server-side actor,
  organization, project and workflow authorization.

These warnings must be evaluated in the security review before production
adoption. They are not silently re-scoped into this baseline-only PR.

### Gate C — production history repair

Only after Gates A and B pass, take a production schema fingerprint and backup,
then schedule a separately approved history-only operation:

```sh
supabase migration repair \
  0001 0002 0003 0004 0005 0006 \
  --status applied \
  --linked
```

This command changes only migration history; it must not be executed until the
linked project identity, snapshot marker and clean replay are independently
verified.

After repair:

1. run `supabase migration list --linked`;
2. confirm only `0007+` are pending;
3. apply Sprint 1 migrations first to a newly created disposable branch based
   on the reconciled production baseline;
4. repeat all RLS, rollback, concurrency, metering and browser gates;
5. request a separate production-adoption decision.

## Current verdict

The repository baseline is now replayable from both an empty local database and
a disposable Supabase preview. Production history remains intentionally
unchanged until security review and a separate production decision.

`LOCAL_BASELINE_REPLAY: RECONCILED`

`DISPOSABLE_BASELINE_REPLAY: RECONCILED`

`PRODUCTION_MIGRATION_BASELINE: NOT_RECONCILED`

`SAFE_TO_RETRY_PRODUCTION_MIGRATIONS: NO`
