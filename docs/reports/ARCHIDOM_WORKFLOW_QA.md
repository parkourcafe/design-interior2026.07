# RemhaOS Workflow QA

Date: 2026-07-28
Status: `PARTIAL`

## 2026-07-30 Production-connected Preview Check

- A fresh Vercel Preview deployment was rebuilt after correcting its public
  Supabase URL to the live `ztnycrchwxqczqbyegnp` project.
- Password authentication succeeded and opened the authenticated dashboard.
- Authenticated project creation, the designer-profile gate, profile save and
  public brief-link generation succeeded.
- The first public brief submission reached the governed workflow command but
  returned `workflow_reservation_failed` before calling YandexGPT.
- The Vercel log identifies the direct cause: missing
  `reserve_initial_brief_ai_call` RPC in the production schema cache.
- Therefore no production-connected `WorkflowRun` or metered `ai_calls` row
  can be claimed from this run. This is a migration-baseline blocker, not an
  Auth, Vercel or Yandex configuration failure.

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
- PR #53 was redeployed after owner-side Vercel environment variable changes.
- PR #53 Vercel/Supabase checks are green at head `563495f`.
- A previously created parent-project intake token now returns
  `404 {"error":"not_found"}` instead of the earlier
  `500 {"error":"workflow_reservation_failed"}` / `PGRST202` path, which is
  consistent with the preview runtime no longer reading the old parent-project
  test row.
- Owner-created confirmed preview Auth user login passed on PR #53 preview.
- Authenticated dashboard project creation passed in Supabase Preview project
  `qudnbhkvzufotlsskcdc`: test project
  `f1a8da7f-50e8-4c59-bd4d-3e63594af792` was created and opened.
- Designer profile gate passed: public client brief link is hidden before
  profile completion and appears after minimum profile fields are saved.
- Public client brief link generation passed:
  `/i/X9NoQJtUc62B2hwp_bb9OPOO`.
- Public client quick brief finalization passed on PR #53 preview:
  `POST /api/intake/submit` returned
  `200 {"ok":true,"llmOk":false,"workflowRunId":"0f1e1218-5640-42f3-b865-1b46352863b6"}`.
- Project Facts review passed: 8 extracted facts were human-confirmed, creating
  immutable v2 fact versions.
- Passport render passed after brief completion.
- Proposal draft generation passed.
- Human release approval gate passed: issue button was blocked before approval
  and enabled after approval.
- `self_approved` UX passed: self-approval displayed
  `Подтверждено автором действия`.
- Proposal issue passed: project status became `proposal_sent`, workflow run
  became `completed`, proposal status became `sent`, and public proposal token
  `VyX40B9tCewE2lEVXZEiEVDp` opened at `/p/VyX40B9tCewE2lEVXZEiEVDp`.
- SQL evidence on `qudnbhkvzufotlsskcdc` for the QA project:
  `workflow_status=completed`, `confirmed_facts=8`, `ai_calls=1`,
  `approvals=2`, `any_self_approved=true`, `proposal_status=sent`.
- Preview health reports `llm_configured=false`; the flow used the fallback
  path and recorded the AI-call ledger row, but live provider-output QA remains
  not proven.

## Workflow Evidence

Implemented governed M1 flow:

`Brief -> Facts -> Review -> Questions -> Passport -> Risk -> Scope -> Fee -> Proposal -> Approval -> Issue`

Execution brief target chronology:

`Brief -> Extract Facts -> Human Review -> Generate Questions -> Project Passport -> Risk Register -> Scope Draft -> Fee Calculation -> Proposal Draft -> Approval -> Issue Proposal`

The persisted implementation remains legacy-compatible. Because clarifying questions currently depend on accepted risk cards, exact target chronology is not fully satisfied without rewriting working M1 behavior. This is intentionally marked `PARTIAL`.

## Browser QA Gap

Authenticated persisted workflow QA passed on PR #53 preview for the fallback
LLM path:

`login -> dashboard -> project -> profile gate -> public brief -> fact review -> passport -> proposal -> approval -> issue`

Live provider-output QA remains not proven because preview health reports
`llm_configured=false`. Production was not touched.

## Verdict

`M1_VERTICAL_WORKFLOW: PARTIAL`

## 2026-07-30 live YandexGPT regression

- Preview build `design-interior2026-07-266lraztk-yulaboober.vercel.app` is Ready.
- A new public QA brief completed with `llmOk=true`.
- Browser regression opened the completed public brief and displayed the final
  acknowledgement screen without a visible application error.
- The persisted workflow is `waiting_for_human / human_review`; its metered
  YandexGPT call succeeded and is recorded in `ai_calls`.

## 2026-07-30 final governed M1 execution and production smoke

This section supersedes the earlier provisional fallback/provider gap.

- A real YandexGPT brief succeeded (`506` input and `354` output tokens) and
  persisted one successful metered `ai_calls` row.
- All eight extracted facts were human-confirmed, producing immutable v2 fact
  versions; all three AI risk cards were accepted.
- The passport, meeting questions and proposal draft rendered in the browser.
- The issue action was blocked until human approval. Self-approval was stored
  and rendered explicitly as `Подтверждено автором действия`.
- The proposal was issued: production evidence is
  `workflow_status=completed`, `proposal_status=sent`,
  `successful_ai_calls=1`, and `self_approvals=2`.
- Desktop and 375x812 mobile browser QA passed for the authenticated proposal
  page and the public proposal page. Application console warning/error logs
  were empty.
- Post-deploy production smoke opened the issued public proposal successfully
  and reported no application console warning/error.

## Final Verdict

`M1_VERTICAL_WORKFLOW: READY`
