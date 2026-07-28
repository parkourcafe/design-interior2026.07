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

## Workflow Evidence

Implemented governed M1 flow:

`Brief -> Facts -> Review -> Questions -> Passport -> Risk -> Scope -> Fee -> Proposal -> Approval -> Issue`

Execution brief target chronology:

`Brief -> Extract Facts -> Human Review -> Generate Questions -> Project Passport -> Risk Register -> Scope Draft -> Fee Calculation -> Proposal Draft -> Approval -> Issue Proposal`

The persisted implementation remains legacy-compatible. Because clarifying questions currently depend on accepted risk cards, exact target chronology is not fully satisfied without rewriting working M1 behavior. This is intentionally marked `PARTIAL`.

## Browser QA Gap

Final exact-hash browser QA is pending. A local Supabase reset was required for final verification, but approval execution was blocked by system approval limits. Production was not touched.

## Verdict

`M1_VERTICAL_WORKFLOW: PARTIAL`
