# Migration matrix `0001…0009`

## Source matrix

`remote` means the current upstream branch at `96e895d9f25fbe1f17ee7b54195bd189f07d0ced`. `local HEAD` means the tree of `5134998def61dae3a7fcf8edb96559d22b9d0845`. A dataless worktree placeholder is present by filename but is not content-verified.

| Migration | Remote | Local HEAD | Worktree | SHA-256 of verified content | Production evidence | Dependencies | Status |
|---|---|---|---|---|---|---|---|
| `0001_init.sql` | yes | yes, blob `bdfd71a8…` | dataless | `d5b9015014ca53d257967b9813a6c2bad664c2e9c69944a6dd92ae648c98625a` | core tables/columns exposed | Supabase `auth`, `storage`; `pgcrypto` | schema present; ledger unknown |
| `0002_client_briefs.sql` | yes | yes, blob `91575dc7…` | dataless | `6ac83d72419a786a951a6887f30bdc592d8b760de016278d5338f896ad98b946` | `designer_id` nullable in OpenAPI shape | `0001.projects` | schema present; ledger unknown |
| `0003_custom_questions.sql` | yes | yes, blob `cab72c3a…` | dataless | `e2b9b43456ea8827c1a81c3e7172d427be6827d76dad06b28e1381e2e580de81` | `custom_questions` exposed | `0001.projects` | schema present; ledger unknown |
| `0004_designer_profile.sql` | yes | yes, blob `00ffe7c5…` | readable, hash match | `823b2f2db7ff590027a058387cda4e0b3f636121ca2121310d40ee02e5233c65` | `profile` exposed | `0001.designers` | schema present; ledger unknown |
| `0005_rate_limits.sql` | yes | yes, blob `f0521391…` | readable, hash match | `d4e32ed66f606abf3537d3ada9ff61a3673c89602e4399be398ea27ca7187af2` | table not exposed | none beyond PostgreSQL ordering | unknown |
| `0006_team.sql` | yes | yes, blob `8ff8314a…` | dataless | `2b56b060b70ae32683d9325de6991447b7530c9cc310842c215753cb4ab6efee` | `studio_members` exposed; function/policies invisible | `0001` tables, `auth.users`, `auth.uid()` | partial schema present; ledger unknown |
| `0007_project_rooms.sql` | no | yes, blob `a13a3c4b…` | **missing** | `474f49491d60bbb200f8f1723a500b3f2c3b7fe0c4769d5507544c07e73a12cc` | all basic room/task tables and columns exposed | `0001` projects/proposals/events; `0006.is_studio_member` | schema-equivalent present; exact ledger origin unknown |
| `0008_concept_packs.sql` | no | yes, blob `c766775b…` | dataless/unhashed | `530a166c4ae5f05b3e43aecba52c1dae4b59f8b1c46a9a771de4d48a84ad1433` for local HEAD | table not exposed | `0001` projects/events; `0006.is_studio_member` | unknown |
| `0009_project_room_workflow.sql` | no | no | readable, worktree-only | `3b6c8623aaa758336434435ddb00cde52f8ab9f223780cfd95080a0491bcaf26` | all added columns absent from exposed tables | **strictly requires `0007`**, plus `0006` | schema says hardening shape absent; ledger unknown |

For `0001…0006`, local HEAD blob IDs equal the current remote snapshot blob IDs. Their SHA-256 values were computed from the readable remote clone, and identical Git blob IDs prove that the HEAD content is the same even though several worktree placeholders are unreadable.

## Per-migration object and risk notes

### `0001`

- Creates `designers`, `projects`, `answers`, `risk_cards`, `proposals`, `events`, indexes, RLS policies, and the private `client-uploads` bucket.
- Destructive behavior: `on delete cascade` removes project children and events with parent deletion.
- Grants: no explicit table/schema/sequence grants; behavior depends on deployment defaults.
- Re-run concern: tables/indexes are guarded, but policy creation is not; the whole file is not re-runnable.
- Rollback is destructive because it would remove the product baseline and stored data.

### `0002`

- Drops `NOT NULL` from `projects.designer_id`.
- Additive access change, but it weakens the original ownership invariant.
- Re-run tested successfully.
- Rollback requires proving there are no null owners before restoring `NOT NULL`.

### `0003`

- Adds `projects.custom_questions jsonb` with default.
- Re-run tested successfully.
- Rollback would lose custom-question data.

### `0004`

- Adds `designers.profile jsonb` with default.
- Re-run tested successfully.
- Rollback would lose profile data.

### `0005`

- Creates `rate_limits`, its index, and enables RLS with no user policies.
- No explicit grants or automated retention job.
- Application behavior is fail-open if the table is unavailable.
- Re-run tested successfully.

### `0006`

- Creates `studio_members`, `is_studio_member`, and replaces owner policies with studio policies.
- `is_studio_member` is `SECURITY DEFINER` with fixed `search_path`, but execute privileges are not explicitly revoked/granted.
- Re-run concern: existing studio policies are created without dropping policies of the same name; the whole file is not re-runnable.
- Rollback must restore every prior owner policy consistently, not only drop the table.

### `0007`

- Extends project/proposal status constraints; backfills accepted statuses.
- Creates `project_rooms`, `project_participants`, `project_tasks`, `project_task_events`, indexes, RLS, and studio policies.
- Destructive/data-changing statements: drops/recreates constraints and updates existing proposals/projects.
- Audit events use cascading foreign keys and a mutable `FOR ALL` studio policy.
- Re-run concern: policies are not guarded or dropped; the whole file is not re-runnable.
- Exact local HEAD content is preserved at `proposed-migrations/0007_project_rooms.sql`; its hash exactly matches the HEAD blob extraction. The extraction snapshot is local HEAD `5134998`; the introduction commit is unknown because older history requires the unreadable pack.

### `0008`

- Creates `concept_packs`, RLS policy, a partial unique event index, and a `SECURITY DEFINER` trigger function with fixed `search_path`.
- Drops and recreates the unique index; trigger/function/policy are replace/drop guarded.
- Execute privileges for the definer trigger function are not explicitly minimized.
- Re-run of the verified local-HEAD version passed.
- Worktree content remains dataless, so it must not be assumed equal to HEAD even though metadata size is plausible.

### `0009`

- Alters every table created by `0007`; therefore `0009 → 0007` is a hard dependency. Without `0007`, the first `ALTER TABLE public.project_rooms` fails.
- Adds versions, workflow states, idempotency columns/indexes, transactional room creation, and task-status RPC.
- Destructive statement: deletes duplicate `project_room_created` events before adding a unique index.
- Replaces constraints and functions; rollback cannot restore deleted duplicate events.
- Task update increments a version under row lock but accepts no expected version, so it is not optimistic concurrency.
- Re-run passed in the disposable bootstrap.

## Proposed continuous chain

The only tested proposal is:

1. verified `0001…0006` content whose blob IDs match remote/local HEAD;
2. exact local-HEAD `0007` copy under Agent 1 ownership;
3. exact local-HEAD `0008` extracted from blob `c766775b…`;
4. readable worktree-only `0009`.

This proposed chain bootstrapped successfully on an empty local PostgreSQL 16 container. It does **not** make the current worktree chain complete: the worktree still lacks `0007`, and its `0008` is not readable.

## Safe rollout order and rollback notes

No production rollout is authorized by this report. After Git and ledger recovery, the order is:

1. compare the authoritative ledger to schema evidence;
2. determine whether production `0007` is the exact migration, an equivalent manual change, or repaired history;
3. classify `0005` and `0008` from ledger/direct schema, not from Data API absence;
4. preserve a schema-only dump and pre-`0009` count/export of duplicate `project_room_created` events;
5. apply only migrations proven pending, always `0007` before `0009`;
6. verify grants, RLS, RPC ACL, and application regression before enabling new paths.

Rollback considerations:

- `0008`: disable/drop trigger and function, then remove the table only if its data has been exported or is disposable; otherwise roll forward.
- `0009`: first disable callers, restore previous application path, then consider removing functions/indexes/columns. Deleted duplicate events cannot be reconstructed from this migration, so a preflight backup is mandatory.
- `0007`: prefer a forward repair. Dropping its tables or reversing status backfills is data-destructive and cannot be automated safely.
