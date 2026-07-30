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

## Rollback Notes

- This package is additive at the migration level.
- Do not apply to production until baseline reconciliation proves compatibility.
- If a disposable verification branch is used, delete it after evidence capture to stop hourly cost.

## Verdict

`MIGRATIONS: PARTIAL`
