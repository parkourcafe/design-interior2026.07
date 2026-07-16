# Wave 2 Integrator decisions

Дата: 16 июля 2026 года.

## D-001 — frozen root domain index

`lib/project-intelligence/index.ts` входит в frozen-input manifest и **не меняется** в
Wave 2. Фраза L1 §4.3 «при принятии — root public export» не применяется в этой волне.

Composition boundary:

```text
lib/project-intelligence/application/index.ts
```

Root integration test импортирует domain и application contracts отдельно. Public
application re-export из domain index рассматривается только после нового freeze/gate.

Причина: сохранить unconditional frozen-manifest oracle и исключить незаметное изменение
уже принятого Domain v0.1 API.

## D-002 — Wave 2 vocabulary precedence

Architecture v1 / L1 vocabulary имеет приоритет внутри application module. Старый
vertical API/events proposal сохраняется read-only и получает будущий delivery mapping:

| Wave 2 application | Older delivery proposal |
|---|---|
| `IMPACT_STALE` | `INVALID_TRANSITION` с controlled detail либо HTTP mapping |
| disposition `dismissed` | `not_applicable` |
| audit intent `impact_run_created` | event `impact_set_calculated` |
| audit intent `logical_handoff_built` | event `handoff_generated` |

Это vocabulary mapping, не изменение domain semantics. До появления delivery adapter
старые transport/event names не экспортируются application layer как aliases.

## D-003 — gate status

Эти решения не меняют frozen files, ownership scopes или database state:

```text
FROZEN_INPUT_CHANGED=false
DATABASE_CHANGED=false
PRODUCTION_CHANGED=false
L2_ALLOWED=false
```

## D-004 — exact published ChangeSet pair

Post-handoff review обнаружил, что validation загруженного из owning port
`PublishedWorkflowChangeSet` принимал любой более поздний `toVersion`, если в нём всё ещё
была выбрана та же `toRevision`. Для L1 это слишком слабая lineage closure.

Принятое правило:

```text
toVersion.baseVersionId === fromVersion.id
toVersion.versionNo === fromVersion.versionNo + 1
```

Integrator добавил guard в
`lib/project-intelligence/application/workflow/service.ts` и regression case V1→V3 в
`workflow.test.ts`. Повторная независимая проверка в trusted materialized clone:
workflow `18/18`, Project Intelligence `116/116`, full suite `171/171`, typecheck и lint
passed.

Это application-integrity correction; frozen domain, database, production, package/config
и Git не менялись.

## D-005 — Wave 2 final acceptance

После owner corrections, Agent 1 Pass 2 и независимого root validation ladder приняты:

```text
ARCHITECTURE_V1=accepted
L1_WORKFLOW=accepted
L1_CHANGE_HANDOFF=accepted
L1_END_TO_END=passed
OPEN_P0=0
OPEN_P1=0
OPEN_P2_CODE_FINDINGS=0
```

Эта приёмка не меняет `BASELINE_READY=false`, `DB1/DB2=false` или `L2_ALLOWED=false`.
Полное evidence находится в `wave-2/INTEGRATION_REPORT.md`.
