# RemHaOS PR #121 — Hosted Staging Security Evidence

Date: 2026-08-29
Branch: `codex/autonomous-staging-acceptance`
Base / merge-base: `497cdcbae0067ef9ed4fa65f31d0dab616f869e9`
Hosted evidence HEAD: `d7532c98bd76010b20cbbf3dd8ff3bd84e611eed`
Hosted workflow run: `33242889095`
Disposable Supabase ref: `ukkzasfsmannjprfkaxp`
Production acceptance: **not declared**

## VERIFIED_HOSTED

- [ИЗВЛЕЧЕНО] GitHub Environment `disposable-staging` supplied the database
  URL, project URL, anon key and service-role key directly to the manual
  workflow. Their values were not read, printed, copied to the repository or
  requested in chat.
- [ИЗВЛЕЧЕНО] Before any database operation, the workflow validated the exact
  disposable ref, pooler username, database, TLS requirement and API hostname,
  and rejected the known production ref.
- [ИЗВЛЕЧЕНО] Hosted staging was cleared with the existing allowlisted
  disposable reset after the exact-ref guard and before AP1 identity creation.
  This makes repeated hosted AP5 runs independent of previous Kora fixtures.
- [ИЗВЛЕЧЕНО] The complete canonical migration ledger contains 90 entries,
  ending with
  `20260829074543_secure_m1_passport_and_contract_rls`. Hosted bootstrap emitted
  `AP1_DB_OK postgres=17.6 migrations=90`.
- [ИЗВЛЕЧЕНО] Hosted runtime verification emitted
  `AP1_RUNTIME_OK ... allowed_schemas=7 private_schemas_blocked=6 auth=true storage=true`
  and `AP1_BOOTSTRAP_OK target=hosted migrations=90 identities=5`.
- [ИЗВЛЕЧЕНО] The blocking Supabase security advisor command completed with
  `HOSTED_SECURITY_ADVISOR_OK errors=0 rls_disabled=0`. Both target public
  tables have RLS enabled; the requested advisor ERROR count is zero.
- [ИЗВЛЕЧЕНО] Hosted AP5 executed the real request-bound
  Auth/PostgREST/browser path and passed 27 tests, with 0 skipped, 0 unexpected
  and 0 flaky. The explicit no-skip gate emitted
  `AP5_NO_SKIPS_OK skipped=0 passed=27`.
- [ИЗВЛЕЧЕНО] Hosted AP5 covered owner, designer, architect, builder, client
  and guest behavior, including invitation acceptance, source/review,
  baseline/release, distribution, change/impact, photo/acceptance, handover,
  replay, CSRF, tenant isolation, worker boundaries and closed increment-2
  operations.
- [ИЗВЛЕЧЕНО] Runtime log hygiene passed before creation of the retained
  sanitized artifact
  `hosted-staging-sanitized-evidence-d7532c98bd76010b20cbbf3dd8ff3bd84e611eed`.

## VERIFIED_RLS_MATRIX

- [ИЗВЛЕЧЕНО] `project_passport_revisions` has `ENABLE RLS` and `FORCE RLS`.
  `anon`, `authenticated`, `service_role`, human executor and worker executor
  have no direct table privileges.
- [ИЗВЛЕЧЕНО] Passport revisions are appended atomically by a protected
  trigger when the existing `projects.passport` request path updates the read
  model. The internal `NOLOGIN NOINHERIT` role receives only `SELECT, INSERT`;
  the trigger function is not executable through Data API roles.
- [ИЗВЛЕЧЕНО] `contract_documents` has `ENABLE RLS` and `FORCE RLS`.
  The exact `projects.designer_id = auth.uid()` owner may select, insert only
  the initial `uploaded` document columns and update only `status`.
- [ИЗВЛЕЧЕНО] Regression SQL proves denial for a studio designer/architect
  member, builder, client, other tenant, unauthenticated caller and direct
  service-role table access. It also proves cross-tenant denial, immutable
  passport revision behavior, revision numbering and `llm_ok` preservation.
- [ИНТЕРПРЕТИРОВАНО] No existing policy was broadened and no service-role
  bypass was introduced for either table.

## VERIFIED_CI_AND_REVIEW

- [ИЗВЛЕЧЕНО] Final hosted workflow run `33242889095` passed on exact security
  HEAD `d7532c98...`.
- [ИЗВЛЕЧЕНО] The same run passed lint with 0 errors and 13 existing warnings,
  typecheck, all 195 test files / 1573 tests and the Next.js production build.
- [ИЗВЛЕЧЕНО] DB4 and DB5 passed on PostgreSQL 16 and 17, including canonical
  replay, tenant/security contracts, concurrency, default-deny and restart
  replay. The ordinary disposable AP5 matrix also passed 27/27 with its
  no-skip and log-hygiene gates.
- [ИЗВЛЕЧЕНО] Automatic push CI `33242695493` and pull-request CI
  `33242696842` passed on the same code HEAD.
- [ИЗВЛЕЧЕНО] Claude Code Review run `33242696823` completed successfully on
  the same code HEAD and posted no inline findings.
- [ИЗВЛЕЧЕНО] Local verification passed DB4 and DB5 on PostgreSQL 16/17,
  lint (0 errors, 13 warnings), typecheck, 195 test files
  (1563 passed, 10 pre-existing skipped), build, migration-ledger digest check
  and `git diff --check`.

## IMPLEMENTED_CODE

- [ИЗВЛЕЧЕНО] Additive migration
  `20260829074543_secure_m1_passport_and_contract_rls.sql` closes both advisor
  findings without rewriting an existing migration.
- [ИЗВЛЕЧЕНО] The intake route no longer reads or inserts passport revisions
  directly with the admin client; the revision is part of the existing project
  update transaction and is appended by the protected database trigger.
- [ИЗВЛЕЧЕНО] Regression coverage was added in
  `tests/db4/56_m1_rls_security.sql`, the release auth-boundary test and the
  hosted workflow contract test.
- [ИЗВЛЕЧЕНО] The migration ledger now contains 90 SHA-256-pinned entries.
- [ИЗВЛЕЧЕНО] Hosted acceptance remains manual and bound to the
  `disposable-staging` GitHub Environment. Repeated runs clear only the
  allowlisted disposable application/Auth fixtures after target validation.

## NOT_AUTHORIZED_AND_NOT_DONE

- [ИЗВЛЕЧЕНО] No production Supabase project, production secret, production
  data, production migration ledger, production Auth/Data API setting, Vercel
  production deployment, domain or real customer record was used or changed.
- [ИЗВЛЕЧЕНО] No PR merge, production deploy, Vercel Promote, domain change or
  staging-project deletion was performed.
- [ИЗВЛЕЧЕНО] PR #121 remains open. The hosted project remains disposable
  staging; a dashboard branch label does not make it the RemHaOS production
  project.

## Sanitized receipt

```json
{
  "status": "passed",
  "scope": "disposable_hosted_staging",
  "headSha": "d7532c98bd76010b20cbbf3dd8ff3bd84e611eed",
  "projectRef": "ukkzasfsmannjprfkaxp",
  "workflowRunId": "33242889095",
  "productionChanged": false,
  "migrationLedger": { "canonical": true, "count": 90 },
  "securityAdvisor": { "errors": 0, "rlsDisabled": 0 },
  "ap1": { "bootstrap": true, "runtime": true, "identities": 5 },
  "ap5": { "passed": 27, "skipped": 0, "unexpected": 0, "flaky": 0 }
}
```

## Gate decision

- [ИНТЕРПРЕТИРОВАНО] The requested repository and disposable hosted staging
  security gate is complete on evidence HEAD `d7532c98...`: both RLS findings,
  regression matrix, canonical migrations, hosted AP1, hosted AP5, DB4/DB5,
  security advisor, CI, Claude review and sanitized evidence passed.
- [ИНТЕРПРЕТИРОВАНО] This is staging evidence only. It is not production
  acceptance or authorization to merge/deploy.
- [ИНТЕРПРЕТИРОВАНО] PR #121 remains open.


## Поправка 2026-09 — К-3: статус PR #121

[ИЗВЛЕЧЕНО] Read-only GitHub `gh pr view 121 --repo
parkourcafe/design-interior2026.07 --json state,mergedAt,mergeCommit`
09.09.2026 вернул MERGED, mergedAt `2026-08-30T06:16:48Z`, merge SHA
`cfe1caae80a0e6c45c0921f044b556e8b8fdb4a2`.
[PR #121](https://github.com/parkourcafe/design-interior2026.07/pull/121).
Фразы «PR #121 remains open» выше относятся к прежнему снимку.

[ИЗВЛЕЧЕНО] Исходный hosted receipt остаётся доказательством только своего
HEAD `d7532c98bd76010b20cbbf3dd8ff3bd84e611eed` и disposable staging.
Слияние не является новым hosted прогоном или production acceptance.
