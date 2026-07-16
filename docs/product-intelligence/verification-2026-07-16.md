# Verification report — 16 июля 2026

## Почему использовалась временная копия

Локальный checkout содержит iCloud `compressed,dataless` placeholders, включая `package.json`, часть `node_modules`, Git index/pack и существующие исходники. Локальные команды поэтому дают недостоверные результаты: npm видит пустой manifest, а placeholder Vitest может завершиться ложным exit 0.

Для проверки создана отдельная clean clone удалённой ветки в `/private/tmp`, в неё скопирован только новый изолированный `lib/project-intelligence`. Временная копия не заменяет проверку локального непушенного HEAD, но доказывает совместимость нового модуля с зафиксированным toolchain.

## Результаты

| Команда | Результат |
|---|---|
| `npm test -- lib/project-intelligence` | 3 files, 9 tests passed |
| `npm test` | 13 files, 64 tests passed |
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run build` | passed, Next.js 16.2.10 |
| `npm audit --omit=dev` | 0 production vulnerabilities |
| `npm audit` | 8 dev-tool findings; исправление требует breaking upgrades |

Автоматический `npm audit fix --force` не выполнялся: он меняет Vitest и `eslint-config-next` через major/breaking upgrade и должен быть отдельной задачей с regression suite.

## Покрытые свойства нового модуля

- sourced AI claim проходит invariants;
- AI claim без evidence отклоняется;
- AI не может назначить human confirmation;
- human status требует actor/timestamp;
- broken/cross-project edges отклоняются;
- change-impact идёт по явной propagation policy;
- non-propagating edges игнорируются;
- cycles не создают бесконечный обход;
- повторяющиеся changed roots дедуплицируются;
- impact paths детерминированы.
- version diff различает added/removed/changed nodes;
- field diff использует стабильные JSON Pointer paths и не зависит от порядка ключей.

## Что ещё нельзя считать проверенным

- полный локальный HEAD `5134998` вместе с uncommitted working tree;
- миграции `0007/0008/0009` на чистой и production database;
- RLS будущей organization/graph schema;
- integration ingestion → persistence → review → version → export;
- data residency двух deployment cells.
