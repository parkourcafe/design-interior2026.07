# RemHaOS Platform Architecture V1 — Sprint 1 implementation

The canonical architecture remains `docs/canonical/archidom-v1/ARCHIDOM_PLATFORM_ARCHITECTURE_v1.1.md`.
This implementation mapping introduces only the M1 vertical foundation through additive relational tables:
`project_sources`, `project_facts`, `workflow_definitions`, `workflow_runs`,
`workflow_step_runs`, `approval_requests`, `audit_events`, `ai_calls`,
`studio_standards`, and `project_overrides`.

Legacy `projects.passport`, `answers`, `risk_cards`, `proposals`, `events`, public
tokens and RLS remain compatible read/write contracts. PostgreSQL foreign keys
implement the Project Graph; no graph database or Module 2–5 code is introduced.

