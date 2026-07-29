# RemhaOS Platform Foundation Execution — 27.07.2026

> **Superseded current-state note (28.07.2026).** This file preserves
> branch-specific historical evidence only. Current code makes both initial and
> risk terminal AI RPCs `service_role`-only, adds 10-minute stale-initial-call
> recovery, atomic proposal creation, exact-digest project-decision approval and
> removes `zai`. Final digest/replay/browser evidence is pending, and the
> canonical target order still conflicts with the observed legacy-compatible
> persisted order. Use `ARCHIDOM_PLATFORM_FOUNDATION_REPORT.md` for verdicts.

## EXTRACTED

Production deployment evidence: `main@1072536`; canonical default:
`claude/new-session-gsayp3@7fd3512`. Baseline migrations were `0001`–`0006`.
M1 already contained intake, passport, risks, pricing and proposal flows.

## INTERPRETED

The smallest compatible foundation is an additive relational ledger around M1.
Legacy tables remain the read models; no graph database or future module was added.

## IMPLEMENTED

- Migrations `0007_platform_foundation_m1.sql` and
  `0008_platform_security_hardening.sql`.
- Immutable, sourced/versioned ProjectFact adapter.
- Persisted M1 workflow and immutable step attempts with resume/retry state.
- Eight-action internal registry.
- Human proposal release gate and explicit self-approval presentation.
- AI usage measurement and `ai_calls` persistence for actual provider calls.
- Durable pre-provider AI reservations and one-transaction finalization of
  usage, passport, risks, workflow step and audit state for both rerun paths.
- Versioned studio standards, project overrides and resolver precedence.
- Append-only audit ledger, least-privilege grants, private membership helper,
  RLS policies and database mutation guards.
- Compact workflow/fact review UI.
- Legacy setup defaults normalized after authenticated browser QA exposed an
  empty-JSON compatibility failure.
- Failed risk-step replay with immutable attempts, idempotency guard, linked AI
  retry measurement and start/completed/failed audit events.
- Corrective exact-revision proposal approval, monotonic issue marker and issued
  content immutability.
- Read-only authenticated workflow/approval ledgers with guarded command RPCs
  and atomic audit writes.

Commands: `npm run test` (104 passing), `npm run lint` (passing),
`npm run typecheck` (passing),
`npm run build` (passing).

## LIVE DISPOSABLE EVIDENCE

Migrations `0007`–`0009` and four timestamped corrective migrations are
applied to Supabase branch `archidom-sprint1-pilot`
(`udtjczcnemndubsyuqxc`). Role negatives and the authenticated end-to-end path
brief → persisted workflow/facts → fact version → passport → proposal → human
approval → issue → public proposal passed.

The completed proposal run persisted 1 workflow, 3 step attempts, 9 fact rows (including
one immutable confirmation version), 1 measured AI call and 4 audit events.
A separate controlled failed workflow proved UI retry/resume: attempt 2 completed,
the earlier completed step remained unchanged, and the linked retry call/audit
events were persisted.

Corrective live proof additionally covered table-API mutation revocation,
row-locked retry commands, revision-bound approval, approval invalidation after
editing, monotonic re-approval, exact revision issue and immutable sent content.

The later PR #51 review fix adds two more additive migrations for durable
AI-call reservation, independent usage persistence and atomic business
finalization. Supabase PR Preview `krspwzipzfuwumzotpmb` applied both migrations.
Catalog proof confirmed all five command RPCs use an empty `search_path`, deny
`anon`, and grant only authenticated execution; lifecycle/outcome constraints
include explicit reserved and abandoned states.

## Remaining production gate

Production migration/deployment and production browser verification are not
executed. The disposable AI call correctly recorded `provider_error` because
pilot provider credentials/rate were intentionally not supplied; deterministic
fallback completed the workflow.

## Changed implementation files

`supabase/migrations/0007_platform_foundation_m1.sql`,
`lib/platform/*`, `lib/llm/provider.ts`, `lib/risks/llm.ts`,
`lib/brief/pipeline.ts`, intake submit route, project review UI/actions and
proposal page/editor/actions.

Initial implementation commit: `000626ef959145e8e149cf5b9ddf7e7ea68556a8`.
