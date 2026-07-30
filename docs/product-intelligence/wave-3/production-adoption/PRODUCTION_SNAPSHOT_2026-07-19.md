# Production read-only snapshot — 2026-07-19

## Scope

Read-only inspection of Supabase project `design2026` (`ztnycrchwxqczqbyegnp`). No
production SQL, migration, Auth, Storage, or configuration write was performed.

## Platform

- Status: `ACTIVE_HEALTHY`
- Region: `ap-northeast-1`
- PostgreSQL: `17.6.1.141` (engine 17, GA)
- Supabase migration ledger: empty (`[]`)

## Public table inventory

All observed public tables have RLS enabled.

| Table | Rows |
|---|---:|
| designers | 5 |
| projects | 17 |
| answers | 54 |
| risk_cards | 1 |
| proposals | 1 |
| events | 34 |
| studio_members | 0 |
| project_rooms | 0 |
| project_participants | 0 |
| project_tasks | 0 |
| project_task_events | 0 |
| rate_limits | 0 |

## Security advisors

1. `public.rate_limits` has RLS enabled but no policy (INFO).
2. `public.is_studio_member(uuid, uuid)` is `SECURITY DEFINER` and executable by
   `anon` (WARN).
3. The same function is executable by `authenticated` (WARN).
4. Supabase Auth leaked-password protection is disabled (WARN).

The function is part of the frozen legacy compatibility contract and is used by
legacy RLS policies. It must not be revoked or replaced in production until a
disposable clone proves an additive compatibility path.

## Performance advisors

- Unindexed foreign keys: `events.project_id`,
  `project_participants.auth_user_id`, `project_task_events.task_id`,
  `project_tasks.assignee_participant_id`.
- Legacy RLS policies use `auth.*` directly instead of initplan-safe
  `(select auth.*())` wrappers.
- Unused indexes were reported on participant/task/event room lookups,
  rate-limit key/created, studio invite token, and answers project id.
- Auth connection strategy is absolute rather than percentage based.

These are clone candidates, not approved production changes. The advisor output
is a finding inventory; it is not evidence that an index or policy can be removed
safely.

## Gate result

```text
PRODUCTION_READ_ONLY_SNAPSHOT=PASS
PRODUCTION_CHANGED=false
MIGRATION_LEDGER_EMPTY=true
CLONE_REHEARSAL=NOT_YET_RUN
PRODUCTION_ADOPTION=NO_GO
```
