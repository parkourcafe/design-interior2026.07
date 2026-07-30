# ТЗ Integrator — приёмка трёх параллельных агентов

Integrator — отдельная роль. Ни один рабочий агент не принимает собственный результат и не сливает его в production branch.

## 1. Входной gate

Получить три `STATUS.md` и проверить:

- Agent 1 зафиксировал `snapshot_captured=true` до first write Agent 2/3;
- state = `complete` или осознанный `blocked`;
- exact files changed;
- validation commands/results;
- отсутствие чужих путей;
- все change requests перечислены;
- нет production mutations/deploys.

Отсутствующий отчёт означает, что агент не завершил работу.

## 2. File-overlap audit

Собрать списки изменённых файлов каждого агента и проверить пересечение.

Допустимое пересечение: **нет**.

Если пересечение найдено:

1. не выбирать «последнюю версию» автоматически;
2. определить владельца по ownership matrix;
3. сохранить чужую правку как change request;
4. восстановить owner version;
5. повторно запустить validation владельца.

## 3. Порядок приёмки

### Gate I1 — Agent 1

Проверить доказательства `BASELINE_READY`.

`BASELINE_READY=true` отклоняется, если `ledger_obtained=false`, даже при совпадении наблюдаемой schema.

Если `false`:

- разрешено принять Agent 2 pure code и Agent 3 docs/fixtures;
- запрещено менять migrations, app integration и production;
- следующий wave остаётся заблокирован на PI-001/PI-002.

Если `true`:

- Integrator сам применяет approved migration repair в отдельной branch;
- повторяет clean bootstrap;
- не применяет `0009` к production в этой волне.

### Gate I2 — Agent 2

1. Сопоставить `contract-v0.1.json` с фактическим `index.ts`.
2. Проверить, что manifest не содержит несуществующих exports/enums.
3. Запустить targeted tests/typecheck/lint.
4. Запустить full tests/build в достоверной среде.
5. Проверить отсутствие imports из app/Supabase/UI.

### Gate I3 — Agent 3

1. Запустить standalone fixture validator.
2. Проверить PII scan вручную по synthetic content.
3. Сопоставить traceability с `vertical-slice-spec.md`.
4. Проверить API operations на role/idempotency/concurrency/error codes.
5. Проверить, что route names отмечены как proposals.

### Gate I4 — Cross-contract adapter

Только Integrator создаёт integration test/adapter, который читает Agent 3 fixtures и прогоняет Agent 2 functions.

Обязательные assertions:

- graph-v1 и graph-v2 проходят domain invariants;
- expected diff точно совпадает с calculated diff;
- changed node IDs передаются impact engine;
- expected impacts точно совпадают с calculated impacts;
- invalid cases возвращают ожидаемые stable error codes;
- fixture validator и TypeScript tests используют одну contract version.

Если JSON shape не совпадает, Integrator сначала проверяет `domain_contract_assumptions`. Нельзя молча менять expected results.

## 4. Merge/commit order

После восстановления Git:

1. commit Agent 1 reports/proposals;
2. commit Agent 2 domain core + contract manifest;
3. commit Agent 3 contracts/fixtures;
4. commit Integrator fixture adapter/integration tests;
5. отдельный commit общих docs/backlog updates.

Не squash всё в один непрозрачный commit до прохождения validation.

Рекомендуемые branch names:

```text
codex/pi-baseline
codex/pi-domain-v01
codex/pi-vertical-contracts
codex/pi-wave1-integration
```

Если агенты работают в общем worktree до восстановления Git, они не выполняют add/commit. Integrator создаёт commits позже по ownership groups.

## 5. Команды приёмки

Команды адаптируются к достоверной среде:

```text
node fixtures/project-intelligence/kitchen-worktop/validate.mjs
npm test -- lib/project-intelligence
npm run typecheck
npm run lint
npm test
npm run build
npm audit --omit=dev
```

Migration bootstrap запускается только локально/disposable и только если Agent 1 gate true.

## 6. Wave completion criteria

Волна завершена, если:

- все agent reports приняты;
- file overlap отсутствует или разрешён владельцем;
- domain contract frozen v0.1;
- fixture pack standalone green;
- cross-contract integration green;
- full test/typecheck/lint/build green в достоверной среде;
- migration readiness честно true/false;
- production не менялась;
- следующий wave имеет конкретный backlog ID.

## 7. Следующее решение

Если `BASELINE_READY=false`:

```text
NEXT = PI-001 / PI-002 only
```

Если `BASELINE_READY=true`, domain/fixture integration green:

```text
NEXT = PI-011 + PI-012 design/review,
затем PI-020/PI-030 additive schema
```

Даже при green нельзя одновременно начинать полный Studio и Renovation build-track.

## 8. Финальный интеграционный отчёт

Создать `docs/product-intelligence/agent-runs/INTEGRATION_REPORT.md`:

- agent outcomes;
- file ownership audit;
- commands и exit codes;
- contract compatibility;
- migration readiness;
- unresolved blockers;
- accepted deviations;
- next backlog IDs;
- explicit statement: production changed / not changed.
