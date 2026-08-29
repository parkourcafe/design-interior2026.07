# RemHaOS Autonomous Staging Acceptance Evidence

Date: 2026-08-29
Branch: `codex/autonomous-staging-acceptance`
Base / merge-base: `497cdcbae0067ef9ed4fa65f31d0dab616f869e9`
Hosted evidence HEAD: `e45358c56f3f0944a12202f38f690f47c9450106`
Hosted workflow run: `33239781977`
Disposable Supabase ref: `ukkzasfsmannjprfkaxp`
Production acceptance: **not declared**

## VERIFIED_HOSTED

- [ИЗВЛЕЧЕНО] GitHub Environment `disposable-staging` supplied the database URL,
  project URL, anon key, and service-role key directly to the manual workflow.
  Their values were not read, printed, copied to the repository, or requested in
  chat.
- [ИЗВЛЕЧЕНО] The workflow validated the exact disposable ref, pooler username,
  database name, TLS requirement, and refused the known production ref before
  any database operation.
- [ИЗВЛЕЧЕНО] Supabase Auth was configured on the disposable project with the
  canonical Postgres Custom Access Token Hook
  `public.projectceo_custom_access_token_hook`. The missing registration had
  produced the reproduced `identity_unverified` failure; after registration the
  same hosted AP5 path passed.
- [ИЗВЛЕЧЕНО] The full canonical migration chain is present on hosted staging:
  independent Supabase migration listing returned exactly 89 entries, from
  `20260716071024 legacy_production_baseline` through
  `20260828020000 projectceo_workspace_read_v11_superseded_approvals`.
- [ИЗВЛЕЧЕНО] Hosted bootstrap emitted
  `AP1_DB_OK postgres=17.6 migrations=89`,
  `AP1_RUNTIME_OK ... allowed_schemas=7 private_schemas_blocked=6 auth=true storage=true`,
  and `AP1_BOOTSTRAP_OK target=hosted migrations=89 identities=5`.
- [ИЗВЛЕЧЕНО] Hosted AP5 executed the real request-bound Auth/PostgREST/browser
  path and passed: 27 passed, 0 skipped, 0 unexpected, 0 flaky. The explicit
  no-skip gate emitted `AP5_NO_SKIPS_OK skipped=0 passed=27`.
- [ИЗВЛЕЧЕНО] Hosted AP5 covered owner, designer, architect, builder, client,
  and guest behavior, including invitation acceptance, source/review,
  baseline/release, distribution, change/impact, photo/acceptance, handover,
  replay, CSRF, isolation, worker boundaries, and closed increment-2 operations.
- [ИЗВЛЕЧЕНО] Hosted runtime log hygiene passed before the sanitized receipt was
  created. The retained artifact is
  `hosted-staging-sanitized-evidence-e45358c56f3f0944a12202f38f690f47c9450106`.
- [ИЗВЛЕЧЕНО] The sanitized receipt records
  `scope=disposable_hosted_staging`, `productionChanged=false`, canonical
  migrations `89`, AP1 bootstrap/runtime true with five identities, and AP5
  `27/0/0/0`.

## VERIFIED_CI

- [ИЗВЛЕЧЕНО] Manual GitHub Actions run `33239781977` completed successfully on
  exact HEAD `e45358c...`.
- [ИЗВЛЕЧЕНО] The same run passed lint with 0 errors and 13 warnings, typecheck,
  all 195 test files / 1572 tests, and the Next.js production build.
- [ИЗВЛЕЧЕНО] DB4 passed on PostgreSQL 16 and 17. DB5 passed on PostgreSQL 16
  and 17. The ordinary disposable AP5 matrix also passed with its no-skip and
  log-hygiene gates.
- [ИЗВЛЕЧЕНО] `.github/workflows/ci.yml` keeps hosted acceptance manual and bound
  to the `disposable-staging` GitHub Environment. Hosted test credentials are
  generated and masked per run; existing disposable test-user passwords are
  rotated only under `AP1_ROTATE_EXISTING_PASSWORD=yes`.
- [ИЗВЛЕЧЕНО] Hosted reruns reset the disposable M3/M4 module gates before
  verifying default-deny and reopening the accepted increments. No broad data
  cleanup or production switch was used.

## CODE_PRESENT

- [ИЗВЛЕЧЕНО] The original PR fix removes the invalid client milestone
  preflight through package data intentionally absent from the published-only
  projection. The existing database RPC still resolves the milestone package
  and rechecks membership and capability.
- [ИЗВЛЕЧЕНО] Regression coverage includes hidden client targets,
  ambiguous/foreign targets, client/guest denial, missing active release,
  replay, idempotency, authenticated area selection, and the closed M4
  increment-2 boundary.
- [ИЗВЛЕЧЕНО] Hosted workflow additions validate the exact staging target,
  canonicalize the six bootstrap ledger rows, replay the canonical chain,
  configure/reload the hosted Data API, run AP1/AP5, reject skipped tests, scan
  runtime logs, and retain only a sanitized receipt.
- [ИЗВЛЕЧЕНО] No migration file is added or changed relative to main. The PR
  currently changes 17 files; the hosted database received only the existing
  89-file canonical chain.

## ADVISOR_FINDINGS

- [ИЗВЛЕЧЕНО] Post-DDL Supabase security advisors returned 11 findings: 2
  `ERROR` and 9 `WARN`. The errors are RLS disabled on
  `public.project_passport_revisions` and `public.contract_documents`.
- [ИЗВЛЕЧЕНО] Security warnings comprise six mutable function search paths, the
  legacy `public.is_studio_member` SECURITY DEFINER function executable by anon
  and authenticated, and leaked-password protection disabled.
- [ИЗВЛЕЧЕНО] Performance advisors returned 236 findings: 216 `INFO` and 20
  `WARN` (`unindexed_foreign_keys`, `auth_rls_initplan`, `no_primary_key`,
  `unused_index`, `multiple_permissive_policies`, and absolute Auth connection
  allocation). Unused-index notices on a fresh disposable database do not prove
  production workload behavior.
- [ИНТЕРПРЕТИРОВАНО] These findings belong to the replayed canonical schema, not
  to a new migration in this PR. They were not silently changed during staging
  acceptance and remain explicit security/performance follow-up before any
  production adoption decision.

## NOT_AUTHORIZED_AND_NOT_DONE

- [ИЗВЛЕЧЕНО] No production Supabase project, secret, data, migration ledger,
  Auth setting, Data API setting, Vercel production deployment, domain,
  provider credential, or real customer record was used or changed.
- [ИЗВЛЕЧЕНО] No PR merge, production deploy, Vercel Promote, staging-project
  deletion, or production acceptance was performed.
- [ИЗВЛЕЧЕНО] The hosted project remains disposable staging. Its dashboard may
  label the main branch “Production”; that UI label does not convert this
  isolated project into the RemHaOS production project.

## Sanitized receipt

```json
{
  "status": "passed",
  "scope": "disposable_hosted_staging",
  "headSha": "e45358c56f3f0944a12202f38f690f47c9450106",
  "projectRef": "ukkzasfsmannjprfkaxp",
  "workflowRunId": "33239781977",
  "productionChanged": false,
  "migrationLedger": { "canonical": true, "count": 89 },
  "ap1": { "bootstrap": true, "runtime": true, "identities": 5 },
  "ap5": { "passed": 27, "skipped": 0, "unexpected": 0, "flaky": 0 }
}
```

## Gate decision

- [ИНТЕРПРЕТИРОВАНО] The requested disposable hosted staging gate is complete
  on evidence HEAD `e45358c...`: canonical migrations, hosted AP1, hosted AP5,
  sanitized evidence, and full CI all passed.
- [ИНТЕРПРЕТИРОВАНО] This is staging evidence only. The advisor findings and
  Vercel/production acceptance remain separate gates.
- [ИНТЕРПРЕТИРОВАНО] PR #121 remains open. Merge and production are not
  authorized by this report.
