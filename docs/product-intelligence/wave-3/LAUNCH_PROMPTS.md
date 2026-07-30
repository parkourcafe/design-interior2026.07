# ProjectCEO Wave 3 — launch prompts

Запускать только после Gate 0 и фиксации одного baseline hash.

## Агент 1

```text
Ты отвечаешь за ProjectCEO RU Core/DB/Access Foundation.

Прочитай:
- docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md
- docs/product-intelligence/wave-3/AGENT_1_CORE_DB_ACCESS.md
- docs/product-intelligence/architecture-v1.md
- docs/product-intelligence/ru-vertical-slice/DB2_STORAGE_ADAPTER_SPEC.md
- docs/product-intelligence/ru-vertical-slice/ADAPTER_ACCEPTANCE_TEST_PLAN.md

Работай только в выданном file ownership. Existing migrations immutable.
Реализуй enrollment → Invitation/AccessGrant → scoped read model → Storage
authorization → initial ingestion → typed DB2 adapters. Прогони PG16/PG17, RLS,
concurrency, idempotency, rollback и restart replay. Не изменяй UI и product domain
без interface request. Production не трогай.

В конце создай report: changed files, interface, tests, hashes, risks, rollback.
```

## Агент 2

```text
Ты отвечаешь за ProjectCEO RU Project Brain, M2/M3 и Kora full-project workflow.

Прочитай:
- docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md
- docs/product-intelligence/wave-3/AGENT_2_PROJECT_BRAIN_KORA.md
- docs/product-intelligence/architecture-v1.md
- public/kora-project-intelligence/README.md
- docs/product-intelligence/agent-runs/ru-validation/kora-food-hall-source-manifest.md

Kora — единый объект около 1 800 м², не room-only demo. Создай DB-ready sanitized
golden, application contracts для Decision/Selection/Approval, baseline/release и
одного change-impact сценария. Не меняй migrations: persistence requirements
передавай Agent 1 как explicit interface request. Не публикуй реальные filenames и
paths в public assets. Production не трогай.

В конце создай report и demo script: full project → V1 → one change → V2 → release.
```

## Агент 3

```text
Ты отвечаешь за ProjectCEO RU UI, roles, thin M4 и pilot readiness.

Прочитай:
- docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md
- docs/product-intelligence/wave-3/AGENT_3_PRODUCT_UI_PILOT.md
- docs/product-intelligence/wave-3/INTEGRATOR_RUNBOOK.md

Сначала работай на frozen mock DTO; real wiring начинай только после Foundation.
Собери owner/architect/builder/client journeys: onboarding, invitations, sources,
reviews, decisions/selections, baseline, release, distribution, acknowledgement,
change and impact. Human actions не используют admin client и не пишут напрямую в
private tables. Static Kora manifest не является production data source.

В конце создай route map, role matrix, browser QA, screenshots и pilot runbook.
```

## Интегратор

```text
Ты главный интегратор ProjectCEO Wave 3.

Выполни Gate 0, заморозь contracts и file ownership. Следи, чтобы Agent 1 владел
migrations/access, Agent 2 — domain/application/Kora fixtures, Agent 3 — UI/delivery.
Не допускай direct private-table access, service-role human actions, room-only Kora,
изменение published snapshots или production apply без отдельного gate.

Принимай работу только после локального DoD. Затем прогони общий vertical slice,
PG16/PG17, security, browser QA и выпусти единый integration report.
```
