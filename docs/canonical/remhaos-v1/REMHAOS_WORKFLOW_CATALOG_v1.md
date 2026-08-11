> Brand-only successor of the corresponding ARCHIDOM document. Product scope and architecture are unchanged except where a later approved addendum explicitly says otherwise.
> Current public brand: RemHaOS. Russian pronunciation: РемХаос. Primary host: https://remhaos.com.

# REMHAOS — WORKFLOW CATALOG v1

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

**Статус:** AUTHORIZED BY A4 (подписан 08.08.2026)

Passport → concepts → three variants → material/budget impact → client approval → Design Freeze.

## WF-M3-001 · Design Intent to Documentation Release

**Статус:** AUTHORIZED BY A5 (подписан 09.08.2026) — в объёме P0 по
`MASTER_EXECUTION_PLAN` §M3

Approved decisions → drawing set → QA/conflicts → specifications → issue package → release authorization.

## WF-M4-001 · Issued Package to Stage Acceptance

**Статус:** PARTIALLY AUTHORIZED BY A6 — INCREMENT 1 ONLY (`distribute_release`, `acknowledge_release`, `create_change`); stage acceptance NOT authorized

Issued baseline → site tasks → RFI/deviation → change/substitution → inspection → evidence → acceptance.

## Auto-trigger policy

Only `free_deterministic` steps may auto-run without cost confirmation. `metered_ai` waits in `pending_cost_confirmation` when studio threshold is exceeded.
