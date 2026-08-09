> SUPERSEDED_BY_BRAND_RENAME_2026-07-28. CURRENT_BRAND: RemHaOS. Successor package: docs/canonical/remhaos-v1/. Historical content preserved for provenance.

# ARCHIDOM — WORKFLOW CATALOG v1

## WF-M1-001 · Client Intake to Issued Proposal

**Статус:** Sprint 1  
**Owner module:** M1  
**Trigger:** brief submitted или ручной запуск дизайнером.

| # | Action | cost_class | Human gate | Output |
|---:|---|---|---|---|
| 1 | extract_client_brief | metered_ai | fact review | ProjectFact[] |
| 2 | generate_clarifying_questions | metered_ai | send/review | OpenQuestion[] |
| 3 | build_project_passport | free_deterministic | confirm facts | passport read model |
| 4 | generate_risk_register | hybrid/metered_ai | accept/reject risks | Risk[] |
| 5 | build_scope_draft | free_deterministic | internal review | ScopeItem[] |
| 6 | calculate_fee | free_deterministic | owner/studio approval | fee range |
| 7 | generate_proposal_draft | metered_ai | proposal approval | ProposalVersion draft |
| 8 | issue_proposal | free_deterministic | RELEASE_AUTHORIZED | issued proposal |

Workflow lifecycle:

```text
queued → running → waiting_for_human | pending_cost_confirmation | retrying
       → completed | failed | cancelled | rolled_back
```

Acceptance: provenance, ai_calls, versioning, self_approval marker, RLS, resume/retry and public token regression.

## WF-M2-001 · Passport to Design Freeze

**Статус:** CATALOG_ONLY / NOT AUTHORIZED FOR SPRINT 1

Passport → concepts → three variants → material/budget impact → client approval → Design Freeze.

## WF-M3-001 · Design Intent to Documentation Release

**Статус:** AUTHORIZED BY A5 (подписан 09.08.2026) — в объёме P0 по
`MASTER_EXECUTION_PLAN` §M3

Approved decisions → drawing set → QA/conflicts → specifications → issue package → release authorization.

## WF-M4-001 · Issued Package to Stage Acceptance

**Статус:** CATALOG_ONLY / NOT AUTHORIZED

Issued baseline → site tasks → RFI/deviation → change/substitution → inspection → evidence → acceptance.

## Auto-trigger policy

Only `free_deterministic` steps may auto-run without cost confirmation. `metered_ai` waits in `pending_cost_confirmation` when studio threshold is exceeded.
