# Aldo implementation decisions

## 2026-09-24 — AW-01 starts as a derived state contract

- Decision: derive phase status from persisted result/evidence/approval facts;
  do not accept a caller-provided completion status.
- Evidence: ALDO specification AW-01 and existing exact-revision/approval
  contracts.
- Alternatives rejected: a UI-only seven-step tracker, because it would permit
  a human-facing control to bypass a required approval.
- Authority: safe default under repository rules and the owner-approved Aldo
  specification.
- Affected requirements: AW-01 and the version-bound approval invariant used
  by AW-02.
