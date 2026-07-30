# RemhaOS Migration Report

Date: 2026-07-28
Status: `PARTIAL`

## Local Migration Evidence

- Migration count: 18 SQL files.
- Final completion migration: `20260728013000_complete_m1_governed_runtime.sql`.
- Final completion migration SHA256: `14dead2c7e2d673b03fa27a713f665cdaabf055853d5b413e21a2c599cdbcc7c`.
- Independent PG17 replay: 18/18 migrations passed.
- Behavioral SQL proof: `FINAL_BEHAVIORAL_SQL_PROOF_OK`.

## Production State

Production Supabase project: `ztnycrchwxqczqbyegnp`

Production was not modified during this pass. It remains in `MIGRATIONS_FAILED` state. Before any production migration attempt, run a separate baseline reconciliation PR and approval gate.

## 2026-07-30 Verification Update

- The production-connected preview reached the governed initial-brief command.
- Vercel function evidence shows `PGRST202`: the production schema cache has no
  `public.reserve_initial_brief_ai_call(p_project_id, p_answer_digest, p_idempotency_key)` RPC.
- The same RPC is present in the isolated local PG17 replay, where all 18
  migrations are applied and all eight Platform Foundation tables exist with
  RLS enabled.
- This proves the migration package is replayable but does **not** reconcile
  the production baseline. No production SQL was executed.
- The authenticated Supabase CLI session available on this machine cannot list
  project `ztnycrchwxqczqbyegnp`; therefore it cannot be used as an authority
  for a production migration-history snapshot.

## 2026-07-30 Production Dashboard Baseline Snapshot

Read-only SQL executed in the production Supabase Dashboard established:

- `supabase_migrations.schema_migrations` contains only `20260719020040`.
- `project_sources`, `project_facts`, `workflow_runs` and `ai_calls` do not
  exist in `public`.
- `reserve_initial_brief_ai_call(uuid,text,text)` does not exist.

The post-baseline package cannot truthfully be treated as a single blind
additive command: it includes controlled replacement of constraints, triggers
and policies, plus governed procedures containing risk-card deletion logic.
Do not execute it against production without a project-data snapshot,
transactional per-migration runbook and rollback point. This is a data-safety
constraint, not a dependency on Supabase Branching.

## 2026-07-30 Pre-migration Recovery and Data Fingerprint

- Supabase Dashboard confirms daily physical backups. The latest available
  restore point is `2026-07-29 15:56:12 UTC`.
- Read-only production data fingerprint: `designers=7`, `projects=19`,
  `answers=54`, `risk_cards=1`, `proposals=1`, `events=37`.
- No production write was made while collecting this evidence.

## Rollback Notes

- This package is additive at the migration level.
- Do not apply to production until baseline reconciliation proves compatibility.
- If a disposable verification branch is used, delete it after evidence capture to stop hourly cost.

## 2026-07-30 Controlled Production Reconciliation — Completed

- A recovery point and the pre-change data fingerprint above were captured first.
- The compatibility bridge and the governed Platform Foundation migrations were
  then applied in version order through the production SQL Editor, each in its
  own transaction. No destructive baseline reset was used.
- Production migration history now contains 13 entries. The eight required
  Platform Foundation tables are present and have RLS enabled.
- Production verification found `workflow_runs`, `project_facts`, `ai_calls`
  and the initial-brief reservation RPC present. A replay on the isolated
  local PostgreSQL environment had already completed successfully.
- The production data fingerprint was not overwritten. Rollback remains a
  restore-to-backup operation followed by replay of pre-change evidence; no
  reverse/destructive migration was introduced.

## Verdict

`MIGRATIONS: PARTIAL`
