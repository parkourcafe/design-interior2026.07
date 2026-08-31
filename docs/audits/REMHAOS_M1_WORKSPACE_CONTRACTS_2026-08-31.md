# RemHaOS M1 Workspace Contracts

Status: implementation PR, not full acceptance and not production readiness.

## Scope and source

- [ИЗВЛЕЧЕНО] Repository: `parkourcafe/design-interior2026.07`.
- [ИЗВЛЕЧЕНО] Source branch: `origin/main` at `cfe1caae80a0e6c45c0921f044b556e8b8fdb4a2`.
- [ИЗВЛЕЧЕНО] PR: `#124` (`https://github.com/parkourcafe/design-interior2026.07/pull/124`).
- [ИЗВЛЕЧЕНО] Current PR HEAD: `a3b49dc1f6ae453a8baedd7d6e2a58157b88506b`.
- [ИЗВЛЕЧЕНО] Implementation commits: `ffdfdcb`, `de97a7a`, `21dd889`, `a3b49dc`.
- [ИЗВЛЕЧЕНО] Working branch: `codex/m1-project-workspace-contracts`.
- [ИЗВЛЕЧЕНО] The checkout was created fresh from the source SHA and was clean before edits.
- [ИЗВЛЕЧЕНО] The branch adds one additive migration; the source checkout contains 90 migration files and the current branch contains 91.

## Delivered

- [ИЗВЛЕЧЕНО] ProjectCEO now has a `passport` workspace tab for server-derived `owner` and `architect` roles.
- [ИЗВЛЕЧЕНО] The tab reads `projectceo_platform_api.list_project_facts` and `list_approval_requests` through a request-bound Postgres adapter.
- [ИЗВЛЕЧЕНО] Human-stated facts require a stated reason and cannot claim a source or source revision.
- [ИЗВЛЕЧЕНО] Extracted/interpreted facts require both source and source revision in the command contract.
- [ИЗВЛЕЧЕНО] Approval decisions require a reviewer-provided reason; self-approval is shown as `Подтверждено автором действия`.
- [ИЗВЛЕЧЕНО] The browser cannot provide `actorId`, `organizationId`, role, approver capability, state revision, or idempotency key as authority fields.
- [ИЗВЛЕЧЕНО] Approval subject kind is the only browser selection; the command service maps it to `review_claim` or `review_selection`.
- [ИЗВЛЕЧЕНО] Draft, submitted, approved and rejected states are shown from the live projection; command targets are server-selected and draft submission is limited to the current actor's server-derived projection.
- [ИЗВЛЕЧЕНО] Client, builder and guest receive empty internal M1 facts/approvals and no M1 operation affordance in the live UI projection.
- [ИЗВЛЕЧЕНО] The fixture workspace was updated as read-only and does not claim that commands work in fixture mode.
- [ИЗВЛЕЧЕНО] Migration `20260831170000_projectceo_platform_approval_request_actor_projection.sql` is additive and its ledger checksum is `ab1575b66fe402867ead7eb57c230c013cb44f2fcc9d25b544160fa7ca8e41a7`.

## Evidence

### VERIFIED

- [ИЗВЛЕЧЕНО] `npm run lint`: pass, 0 errors, 13 existing warnings.
- [ИЗВЛЕЧЕНО] `npm run typecheck`: pass.
- [ИЗВЛЕЧЕНО] `npm test`: 196 files passed; 1,572 tests passed; 10 existing tests skipped.
- [ИЗВЛЕЧЕНО] `npm run build`: pass; Next.js production build completed.
- [ИЗВЛЕЧЕНО] `npm run test:db4`: pass on `postgres:16-alpine` and `postgres:17-alpine`, including platform facts, approval requests, M1 RLS, concurrency and restart replay.
- [ИЗВЛЕЧЕНО] `npm run test:db5`: pass on `postgres:16-alpine` and `postgres:17-alpine`, including execution security, concurrency and restart replay.
- [ИЗВЛЕЧЕНО] Current branch contains 91 migration files and the migration ledger contains 91 entries.
- [ИЗВЛЕЧЕНО] Changed-file and staged diff scans found no bearer, JWT, password, private-key or provider-key pattern.

### CI_EVIDENCED

- [ИЗВЛЕЧЕНО] Earlier PR-head CI on the pre-review-fix state passed AP5, lint/typecheck/test/build, DB4 PG16/PG17, DB5 PG16/PG17 and change scope; that receipt is historical and is not exact-head evidence for `a3b49dc`.
- [ИЗВЛЕЧЕНО] Exact-head CI for `a3b49dc` did not start its jobs because GitHub reported failed recent account payments or an insufficient spending limit.

### CODE_PRESENT

- [ИЗВЛЕЧЕНО] Existing immutable `public.project_passport_revisions` and `public.contract_documents` contracts remain in the legacy M1 line.
- [ИЗВЛЕЧЕНО] Existing legacy intake/proposal routes are separate from the new ProjectCEO platform adapter.

### BLOCKED_EXTERNAL

- [ИЗВЛЕЧЕНО] Canonical local `npm run test:ap5` did not start because `NEXT_PUBLIC_SUPABASE_URL` was not present in the environment. No credential was invented or read from a secret file.
- [ИЗВЛЕЧЕНО] Exact-head GitHub checks for AP5, lint/typecheck/test/build, change scope and Claude review were blocked before execution by the GitHub billing/spending-limit message; DB4 and DB5 exact-head CI jobs were skipped as a consequence.
- [ИЗВЛЕЧЕНО] `npx impeccable detect` did not start because the local npm cache contains root-owned files and npm returned `EPERM`.
- [ИЗВЛЕЧЕНО] Hosted staging authenticated browser evidence is not present in this checkout/run.

### NOT_AUTHORIZED

- [ИЗВЛЕЧЕНО] Production Supabase, production secrets, Vercel Promote, custom domains, provider credentials and hosted staging configuration were not changed.
- [ИЗВЛЕЧЕНО] No merge, production deployment or production acceptance was performed.

## Remaining M1 gap

- [ИЗВЛЕЧЕНО] The PR connects the existing platform `project_facts` and approval-request contracts to the unified ProjectCEO workspace.
- [ИЗВЛЕЧЕНО] It does not yet create a unified read/write bridge for the legacy passport revision and contract-document tables, and it does not make the legacy `sendProposal` path require the new platform approval request.
- [ИНТЕРПРЕТИРОВАНО] M1 is improved and locally regression-tested, but M1 is not complete until that bridge and proposal approval gate are designed and accepted as a separate additive contract.

## Next executable PR/TЗ

1. Add an additive, request-bound M1 bridge for passport revision status and contract-document lifecycle, with explicit mapping between the legacy project and ProjectCEO project.
2. Add a server-enforced proposal issue gate that cannot be bypassed by the legacy route.
3. Re-run AP1/AP5 on hosted disposable Supabase with five authenticated sessions and record the sanitized receipt.
4. Keep production deployment and production database outside this gate.
