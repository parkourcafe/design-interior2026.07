# ArchiDom M1 Vertical Workflow QA — 27.07.2026

## Automated evidence

- 15 test files, 72 tests passing.
- Passport regression: 12 tests.
- Pricing regression: 4 tests.
- Risk rules/schema/dedupe/LLM tests passing.
- Workflow transitions, retry, fact versioning, action contracts, approval label,
  resolver precedence and migration security contract passing.
- Production build and TypeScript compilation passing.

## Browser evidence

Local production runtime (`next start`) was built with disposable branch
credentials. Authenticated login and the complete client/designer path passed:

`project → public brief → workflow/facts → human fact review → passport → risk
fallback → proposal → approval → issue → public proposal`.

The UI displayed `Подтверждено автором действия` for self-approval rather than
representing it as independent review. The public proposal passed at 390×844
with `scrollWidth = innerWidth = 390` and no console warning/error in a fresh
tab.

Browser QA found and fixed a legacy compatibility failure where an empty
`proposal_defaults = {}` crashed setup. The fixed page was rechecked.

## Database evidence

Migrations `0007` and `0008` were applied successfully to disposable Supabase
branch `archidom-sprint1-pilot`. Cross-studio isolation, anon denial, AI fact
confirmation denial, append-only ledger permissions, approval immutability and
workflow state transitions passed live SQL role tests.

Final database evidence for the browser run:

- workflow `completed`, current step `issue_proposal`;
- approval `approved`, `self_approved = true`;
- proposal `sent` with public token;
- fact version created through `supersedes_id`;
- 4 audit events and 1 metered AI-call record.

## Remaining gate

Production migration/deployment, production browser regression and a successful
credentialed YandexGPT call were not executed. Retry state/guard logic passes
unit and SQL tests, but a browser-driven failed-step replay remains unproved.

Verdict: `M1_VERTICAL_WORKFLOW: PARTIAL`.
