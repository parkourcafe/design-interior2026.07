# ArchiDom M1 Vertical Workflow QA — 27.07.2026

## Automated evidence

- 15 test files, 71 tests passing.
- Passport regression: 12 tests.
- Pricing regression: 4 tests.
- Risk rules/schema/dedupe/LLM tests passing.
- Workflow transitions, retry, fact versioning, action contracts, approval label,
  resolver precedence and migration security contract passing.
- Production build and TypeScript compilation passing.

## Browser evidence

Local production runtime (`next start`) checked at 1280×720 and 390×844.
Home, demo brief, demo proposal, login and security pages loaded. Mobile pages
had no horizontal overflow. Captured console warnings/errors: none.

## BLOCKED

Authenticated project → brief → fact review → passport → risks → pricing →
proposal → approval → issue cannot be marked passing without applying migration
`0007` to a disposable database and using authenticated role sessions. Public
token regression against production data was not attempted.

Verdict: `M1_VERTICAL_WORKFLOW: PARTIAL`.

