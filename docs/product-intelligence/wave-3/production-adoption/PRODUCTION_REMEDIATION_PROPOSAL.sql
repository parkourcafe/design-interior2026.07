-- PROPOSAL ONLY. Do not execute against production.
-- First target: disposable authenticated clone with a restored backup.

-- 1) Additive FK indexes. Validate with EXPLAIN and write-load rehearsal first.
create index concurrently if not exists events_project_id_idx
  on public.events (project_id);
create index concurrently if not exists project_participants_auth_user_id_idx
  on public.project_participants (auth_user_id);
create index concurrently if not exists project_task_events_task_id_idx
  on public.project_task_events (task_id);
create index concurrently if not exists project_tasks_assignee_participant_id_idx
  on public.project_tasks (assignee_participant_id);

-- 2) RLS initplan hardening is policy replacement, not a blind global rewrite.
-- For every affected policy, clone and compare the old/new policy with the
-- authenticated test matrix before replacing it. Example shape only:
--   using ((select auth.uid()) = owner_id)
-- Do not apply this block until every legacy policy has a named replacement and
-- an evidence-backed regression result.

-- 3) rate_limits requires an explicit ownership model before a policy exists.
-- Do not invent a permissive policy. If it is server-only, revoke client table
-- privileges and keep writes behind a request-bound server route instead.

-- 4) is_studio_member remains legacy-compatible during clone rehearsal.
-- Candidate hardening (only after route inventory and RLS tests):
-- revoke execute on function public.is_studio_member(uuid, uuid)
--   from anon, authenticated;
-- Replace policy calls with an internal, non-client-executable contract.

-- 5) Leaked-password protection is a Supabase Auth configuration change, not
-- a SQL migration. Enable it only after disposable Auth verification.

-- Rollback for indexes: drop only the named additive indexes after proving no
-- dependent query plan requires them.
-- drop index concurrently if exists public.events_project_id_idx;
-- drop index concurrently if exists public.project_participants_auth_user_id_idx;
-- drop index concurrently if exists public.project_task_events_task_id_idx;
-- drop index concurrently if exists public.project_tasks_assignee_participant_id_idx;
