# ArchiDom Workflow QA

Date: 2026-07-28
Status: `PARTIAL`

## Verified Locally

- Full unit/contract suite passed: 62 files, 253 tests.
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
- PR #53 was redeployed at head `e4465ed` after owner-side Vercel environment
  variable changes.
- PR #53 Vercel/Supabase checks are green at head `e4465ed`.
- A previously created parent-project intake token now returns
  `404 {"error":"not_found"}` instead of the earlier
  `500 {"error":"workflow_reservation_failed"}` / `PGRST202` path, which is
  consistent with the preview runtime no longer reading the old parent-project
  test row.
- Supabase SQL evidence for preview branch `qudnbhkvzufotlsskcdc` shows the
  previously supplied test accounts are not present in preview Auth.
- Password login on PR #53 preview with the supplied test account currently
  returns `Invalid login credentials`.
- Self-service signup on PR #53 preview creates an unconfirmed Auth user and
  requires email confirmation. The connector allows read-only inspection of
  `auth.users` but rejected the attempted confirmation update, so no manual
  private Auth-table mutation was used to bypass confirmation.

## Workflow Evidence

Implemented governed M1 flow:

`Brief -> Facts -> Review -> Questions -> Passport -> Risk -> Scope -> Fee -> Proposal -> Approval -> Issue`

Execution brief target chronology:

`Brief -> Extract Facts -> Human Review -> Generate Questions -> Project Passport -> Risk Register -> Scope Draft -> Fee Calculation -> Proposal Draft -> Approval -> Issue Proposal`

The persisted implementation remains legacy-compatible. Because clarifying questions currently depend on accepted risk cards, exact target chronology is not fully satisfied without rewriting working M1 behavior. This is intentionally marked `PARTIAL`.

## Browser QA Gap

Authenticated persisted workflow QA is currently blocked before dashboard entry
because preview branch `qudnbhkvzufotlsskcdc` has no confirmed test Auth user.
Owner action is required to create or confirm a preview Auth user, then rerun:

`login -> dashboard -> project -> profile gate -> public brief -> fact/risk review -> proposal -> approval -> issue`

Production was not touched.

## Verdict

`M1_VERTICAL_WORKFLOW: PARTIAL`
