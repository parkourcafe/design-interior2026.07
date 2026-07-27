# ArchiDom Platform Foundation Execution — 27.07.2026

## EXTRACTED

Production deployment evidence: `main@1072536`; canonical default:
`claude/new-session-gsayp3@7fd3512`. Baseline migrations were `0001`–`0006`.
M1 already contained intake, passport, risks, pricing and proposal flows.

## INTERPRETED

The smallest compatible foundation is an additive relational ledger around M1.
Legacy tables remain the read models; no graph database or future module was added.

## IMPLEMENTED

- Migration `0007_platform_foundation_m1.sql`.
- Immutable, sourced/versioned ProjectFact adapter.
- Persisted M1 workflow and immutable step attempts with resume/retry state.
- Eight-action internal registry.
- Human proposal release gate and explicit self-approval presentation.
- AI usage measurement and `ai_calls` persistence for actual provider calls.
- Versioned studio standards, project overrides and resolver precedence.
- Append-only audit ledger and RLS policies.
- Compact workflow/fact review UI.

Commands: `npm test -- --run` (71 passing), `npm run lint` (passing),
`npm run build` (passing).

## BLOCKED

Production migration/application, authenticated Supabase E2E and production
browser verification are not executed. The connected Supabase account does not
list the project ref used by the existing local ArchiDom configuration.

## Changed implementation files

`supabase/migrations/0007_platform_foundation_m1.sql`,
`lib/platform/*`, `lib/llm/provider.ts`, `lib/risks/llm.ts`,
`lib/brief/pipeline.ts`, intake submit route, project review UI/actions and
proposal page/editor/actions.

Commit SHA: pending commit at report generation.

