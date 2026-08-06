# ArchiDom — Product Intelligence / RU delivery

Текущий продуктовый источник истины — утверждённый
[Product Charter v0.4](./ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md).

ArchiDom — один публичный продукт и одна Память проекта с четырьмя ролевыми
рабочими пространствами:

1. M1 · Заказчик;
2. M2 · Дизайнер;
3. M3 · Архитектор;
4. M4 · ГлавПрораб.

`ProjectCEO` сохраняется только как internal compatibility namespace существующих
DB/API/code contracts. ProUp как отдельная редакция отменён. Текущий delivery и
production-adoption scope — только RU.

## Принятые документы

1. [Product Charter v0.4](./ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md) — продукт, модули, монетизация, гипотезы и открытые решения.
2. [Architecture v1](./architecture-v1.md) — слоистая архитектура и технические инварианты с v0.4 compatibility notice.
3. [ADR-0004](./adr/0004-one-archidom-four-workspaces.md) — публичный ArchiDom, четыре workspace и сохранение internal namespaces.
4. [Master Execution Plan](./wave-3/MASTER_EXECUTION_PLAN.md) — текущий путь к authenticated RU pilot.
5. [Project Graph](./project-graph.md) — каноническая provenance/version/change-impact модель.
6. [Domain contract](./domain/contract-v0.1.md) — frozen pure-domain contract.
7. [Kora pilot-ready report](./wave-3/pilot/PILOT_READY_REPORT.md) — accepted local evidence и его ограничения.
8. [Request-bound UI report](./wave-3/integration/REQUEST_BOUND_UI_REPORT.md) — принятый application слой и remaining live gaps.
9. [Production Adoption Plan](./wave-3/production-adoption/PRODUCTION_ADOPTION_PLAN.md) — отдельная production boundary.
10. [Charter v0.4 adoption report](./wave-3/CHARTER_V0_4_ADOPTION_REPORT.md) — traceability принятия нового контракта.
11. [M2 P0 handoff для нового чата](./M2_P0_NEW_CHAT_HANDOFF_2026-08-06.md) — фактический статус циклов 1–7, evidence, intentional RED и следующий шаг.

Исторические architecture/product документы сохраняются для traceability, но их
противоречащие v0.4 product/edition/naming решения не являются действующим scope.

## Текущий статус

```text
LOCAL_PROJECT_BRAIN_CORE=accepted
KORA_DETERMINISTIC_E2E=pass
SANITIZED_BROWSER_QA=pass
AUTHENTICATED_BROWSER_QA=pending
EXTERNAL_PACKAGE_GATE=pending
PRODUCTION_READY=false
```

Следующий исполнимый gate — disposable Supabase с настоящими request-bound sessions,
полным обязательным command/read surface и authenticated Kora browser matrix. Затем
тот же data model проходит внешний реальный пакет.

## Порядок

```text
Charter v0.4 adoption
  → AP1 disposable Auth/PostgREST/Storage environment
  → AP2 additive read contracts
  → AP3 request-bound command surface
  → AP4 direct route/security tests
  → AP5 authenticated Kora E2E
  → AP6 external package
  → paid wedge validation
  → separate production-adoption decision
```

Никакой локальный PASS не разрешает production writes, deploy или изменение migration
history без заполненного adoption checklist и отдельного GO.
