-- ArchiDom Sprint 1: one active attempt per workflow step.
-- Prevents duplicate attempts when a retry action is submitted concurrently.

create unique index if not exists workflow_step_runs_one_active_attempt_idx
on public.workflow_step_runs(workflow_run_id, step_key)
where status in ('queued', 'running', 'waiting_for_human', 'pending_cost_confirmation');
