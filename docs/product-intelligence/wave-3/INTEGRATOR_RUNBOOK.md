# ProjectCEO Wave 3 — Runbook главного интегратора

## Ответственность

Интегратор управляет не людьми, а контрактами, зависимостями и гейтами.

## Порядок

1. Выполнить Gate 0 и зафиксировать один baseline.
2. Заморозить Package identity, role/capability matrix и one-project/one-organization
   invariant.
3. Выдать каждому агенту exact file ownership.
4. Запустить агента 1 на Foundation.
5. Параллельно разрешить агентам 2/3 только fixtures, contracts и UI mock adapters.
6. После Foundation freeze запустить реальную интеграцию B/C.
7. Принимать результаты только с tests/report.
8. Выполнить cross-module vertical slice.
9. Выполнить PG16/PG17/security/browser gates.
10. Провести Kora demo.
11. Подготовить отдельный production-adoption plan.

## Контрольные вопросы на каждом merge

- Не изменён ли frozen domain invariant?
- Не добавлен ли direct private-table access?
- Actor/scope выведен server-side?
- Revision/version immutable?
- Source/evidence version-scoped?
- Change имеет who/when/why?
- Impact derived, а не прислан клиентом?
- Guest access hashed/expiring/revocable?
- Audit append-only и без PII?
- Есть negative and replay tests?

## Стоп-сигналы

- dirty/unmaterialized baseline;
- падающий typecheck/test/build;
- изменение existing migration;
- service-role human action;
- direct private relation access;
- UI, создающий собственную authorization truth;
- automatic approval;
- room-only data model для Kora;
- production apply без отдельного gate.

## Итоговый acceptance

Интегратор публикует один отчёт:

```text
BASELINE_GREEN
FOUNDATION_GREEN
M2_GREEN
M3_GREEN
M4_THIN_GREEN
KORA_GOLDEN_GREEN
PG16_GREEN
PG17_GREEN
SECURITY_GREEN
PILOT_READY
PRODUCTION_ADOPTION_SEPARATE
```
