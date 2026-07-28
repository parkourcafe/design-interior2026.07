# ArchiDom Workflow QA

Date: 2026-07-28
Status: `PARTIAL`

## Verified Locally

- Full unit/contract suite passed: 61 files, 250 tests.
- Targeted high-risk workflow suite passed: 11 files, 61 tests.
- Production build passed on Next.js 16.2.10.
- Workflow persistence, retry, proposal approval, issue binding, pricing and passport contracts passed.
- Preliminary browser QA passed for desktop full flow.
- Preliminary mobile QA passed after dashboard header overflow fix.
- PR #53 Vercel preview browser smoke passed on 2026-07-28 at head `69cacbb`:
  desktop `/`, `/demo/brief`, `/demo/proposal`, `/login`, `/security`, `/api/health`;
  mobile 390x844 for `/`, `/demo/brief`, `/demo/proposal`, `/login`, `/security`.
- Browser console warnings/errors: `0` on checked public routes.
- Horizontal overflow: `0` on checked desktop and mobile routes.
- Interactive mobile demo brief transitions passed through four steps with input,
  choice selection and `Далее`.
- Public API guardrails passed:
  `/api/client/create` returns `503 self_serve_intake_unavailable`;
  invalid `/api/intake/submit` returns `400 invalid_payload`;
  empty `/api/intake/upload` returns `400 bad_request`.
- Authenticated preview login passed on PR #53 preview with the provided
  confirmed test account `booberid@gmail.com`.
- Authenticated dashboard project creation passed in Supabase Preview project
  `qudnbhkvzufotlsskcdc`: test project
  `QA Sprint1 2026-07-28 08:43` was created and opened.
- Designer profile gate passed: public client brief link is hidden before
  profile completion and appears after minimum profile fields are saved.
- Public client brief link generation and clipboard copy passed.
- Public client quick brief entry passed through all 7 currently implemented
  quick questions with no browser console warnings/errors.
- Public client quick brief finalization currently fails on PR #53 preview:
  `POST /api/intake/submit` returns
  `500 {"error":"workflow_reservation_failed"}`.
- Vercel server log evidence for that failure:
  Supabase PostgREST returned `PGRST202` because its schema cache could not
  find `public.reserve_initial_brief_ai_call(p_answer_digest, p_idempotency_key, p_project_id)`.
  Additive migration `20260728090000_reload_m1_workflow_rpc_schema_cache.sql`
  was added to preflight the governed M1 RPCs and trigger `notify pgrst,
  'reload schema'`.

## Workflow Evidence

Implemented governed M1 flow:

`Brief -> Facts -> Review -> Questions -> Passport -> Risk -> Scope -> Fee -> Proposal -> Approval -> Issue`

Execution brief target chronology:

`Brief -> Extract Facts -> Human Review -> Generate Questions -> Project Passport -> Risk Register -> Scope Draft -> Fee Calculation -> Proposal Draft -> Approval -> Issue Proposal`

The persisted implementation remains legacy-compatible. Because clarifying questions currently depend on accepted risk cards, exact target chronology is not fully satisfied without rewriting working M1 behavior. This is intentionally marked `PARTIAL`.

## Browser QA Gap

Authenticated dashboard QA is no longer blocked by login with the confirmed test
account. It is blocked later at public brief finalization because Supabase
Preview PostgREST did not expose the governed M1 reservation RPC through its
schema cache. Production was not touched.

## Verdict

`M1_VERTICAL_WORKFLOW: PARTIAL`
