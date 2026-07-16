# Режим двух параллельных агентов

Если доступны только два рабочих агента, использовать следующее разделение.

## Agent A — Baseline & Migration Integrity

Выполняет все содержательные требования ТЗ Agent 1. Единственная orchestration-подстановка: run path `agent-1` заменяется на `agent-A`, а snapshot охватывает объединённые write scopes Agent B.

- PI-001/PI-002 evidence;
- dataless/Git integrity;
- migration matrix;
- production read-only observation;
- proposed repair;
- disposable bootstrap;
- security review.

Write scope:

```text
docs/product-intelligence/agent-runs/agent-A/**
```

Agent A не пишет domain code/fixtures и не применяет migrations.

## Agent B — Domain + Vertical Contract

Объединяет Agent 2 и Agent 3, но выполняет их **последовательно внутри своей ветки**:

### B1. Сначала domain freeze

- завершает `lib/project-intelligence/**`;
- запускает targeted tests;
- создаёт `domain/contract-v0.1.*`;
- фиксирует внутренний checkpoint `DOMAIN_FROZEN`.

### B2. Затем fixtures/contracts

- не меняет domain API без явного возврата в B1;
- создаёт vertical-slice docs и fixtures;
- запускает standalone validator;
- создаёт adapter test fixture → domain;
- повторяет domain/full validation.

Write scope:

```text
lib/project-intelligence/**
docs/product-intelligence/domain/**
docs/product-intelligence/vertical-slice/**
fixtures/project-intelligence/**
docs/product-intelligence/agent-runs/agent-B/**
```

Agent B не меняет app, SQL, packages или common architecture docs.

## Параллельный граф

```text
START → Agent A snapshot ─┬─ Agent A: baseline/migrations ───────┐
                          └─ Agent B: domain → fixtures/contract ┼─ Integrator
```

Agent B читает входы сразу, но начинает запись только после `snapshot_captured=true` от Agent A.

Agent B ведёт один `agent-runs/agent-B/STATUS.md`. После B1 он записывает `domain_frozen=true`, hash manifest и список public breaking changes; затем начинает B2. Поскольку Agent B владеет обеими сторонами контракта, он добавляет cross-contract test под `lib/project-intelligence/**`, но не создаёт application/DB adapter.

## Почему нельзя объединять иначе

Baseline/migration agent должен оставаться независимым от feature code, потому что он оценивает достоверность исходного состояния и потенциально обнаруживает пользовательские изменения. Объединять baseline с domain coding опаснее, чем объединить domain и fixtures.

## Acceptance

Требования обоих исходных ТЗ сохраняются. Упрощение числа агентов не сокращает test matrix, fixture pack или migration evidence.

Integrator проверяет:

- Agent A не менял feature paths;
- Agent B не менял migration/app paths;
- B1 manifest создан до B2 fixtures;
- cross-contract tests green;
- database integration остаётся заблокированной, если Agent A вернул false.
