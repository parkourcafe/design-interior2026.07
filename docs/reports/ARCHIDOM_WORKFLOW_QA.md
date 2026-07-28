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

## Workflow Evidence

Implemented governed M1 flow:

`Brief -> Facts -> Review -> Questions -> Passport -> Risk -> Scope -> Fee -> Proposal -> Approval -> Issue`

Execution brief target chronology:

`Brief -> Extract Facts -> Human Review -> Generate Questions -> Project Passport -> Risk Register -> Scope Draft -> Fee Calculation -> Proposal Draft -> Approval -> Issue Proposal`

The persisted implementation remains legacy-compatible. Because clarifying questions currently depend on accepted risk cards, exact target chronology is not fully satisfied without rewriting working M1 behavior. This is intentionally marked `PARTIAL`.

## Browser QA Gap

Authenticated dashboard QA for the full persisted flow remains blocked on preview:
the app requires a real Supabase Auth session/test account for project creation,
review, proposal approval and issue. Self-serve ownerless project creation is
intentionally disabled. Production was not touched.

## Verdict

`M1_VERTICAL_WORKFLOW: PARTIAL`
