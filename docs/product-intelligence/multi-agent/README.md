# Параллельная волна Project Intelligence

Рекомендуемая конфигурация: **три рабочих агента + отдельный интегратор**. Рабочие агенты не сливают и не коммитят результаты самостоятельно.

Перед параллельной записью действует короткий автоматический `Gate 0`: Agent 1 снимает hash/metadata snapshot путей Agent 2/3 и пишет `snapshot_captured: true`. До этого Agent 2/3 могут читать входные документы, но не меняют workspace. Это защищает исходное dirty state без участия пользователя.

## Результат волны

После завершения должны существовать три независимых пакета:

1. достоверный baseline репозитория и миграций;
2. замороженный pure-domain контракт Project Graph v0.1;
3. API/UI-контракты и синтетические fixtures первого вертикального среза.

Эта волна **не** включает production migration, подключение UI к новой базе, деплой или выбор между Studio и Renovation.

## Роли

| Агент | Ответственность | Основной результат |
|---|---|---|
| Agent 1 | Repository & Migration Integrity | решение `BASELINE_READY=true/false` с доказательствами |
| Agent 2 | Project Graph Domain Core | стабильный публичный TypeScript-контракт и тесты |
| Agent 3 | Vertical Slice Contracts | API/UI states, fixtures, expected diff/impact/handoff |
| Integrator | совместимость и приёмка | единый verification report и решение о следующей волне |

Подробные ТЗ:

- [agent-1-repository-migrations.md](./agent-1-repository-migrations.md)
- [agent-2-domain-core.md](./agent-2-domain-core.md)
- [agent-3-vertical-contracts.md](./agent-3-vertical-contracts.md)
- [integration-and-merge.md](./integration-and-merge.md)
- [two-agent-mode.md](./two-agent-mode.md)
- [launch-prompts.md](./launch-prompts.md)

## Исходный baseline

- local HEAD, прочитанный из ref: `5134998`;
- remote branch snapshot: `96e895d`;
- часть Git index/pack и tracked files остаётся `compressed,dataless`;
- remote содержит migrations `0001–0006`;
- local HEAD содержит `0007/0008`;
- worktree содержит `0008/0009`, но не `0007`;
- production Data API подтверждает basic schema `0007`, но не changes из `0009`;
- полный `supabase_migrations.schema_migrations` недоступен через Data API.

Ни один агент не имеет права трактовать remote snapshot как полный локальный baseline.

## File ownership

Пути являются эксклюзивными. Агент может читать весь репозиторий, но писать только в свои пути.

| Владелец | Разрешённые пути записи |
|---|---|
| Agent 1 | `docs/product-intelligence/agent-runs/agent-1/**` |
| Agent 2 | `lib/project-intelligence/**`, `docs/product-intelligence/domain/**`, `docs/product-intelligence/agent-runs/agent-2/**` |
| Agent 3 | `docs/product-intelligence/vertical-slice/**`, `fixtures/project-intelligence/**`, `docs/product-intelligence/agent-runs/agent-3/**` |
| Integrator | `supabase/migrations/**`, `app/**`, общие индексы/docs, integration tests, Git staging/commits |

Agent 1 сохраняет предлагаемые версии migrations только под `agent-runs/agent-1/proposed-migrations/`. Он не восстанавливает и не перезаписывает рабочие migrations напрямую.

Исключение из logical write scope Agent 1: разрешены iCloud materialization без изменения содержимого и защищённый pre-wave snapshot в `/private/tmp/pi-project-intelligence-*`. Содержимое snapshot не цитируется и не коммитится.

## Общие read-only источники истины

Все агенты обязаны прочитать:

1. `docs/product-intelligence/architecture-v0.1.md`;
2. `docs/product-intelligence/project-graph.md`;
3. `docs/product-intelligence/vertical-slice-spec.md`;
4. `docs/product-intelligence/technical-audit-2026-07-16.md`;
5. `docs/product-intelligence/production-schema-observation-2026-07-16.md`;
6. `docs/product-intelligence/codex-execution-spec.md`;
7. `docs/product-intelligence/adr/*.md`.

Эти файлы в рамках волны меняет только Integrator после приёмки.

## Общие запреты

- production SQL writes, `db push`, `db reset` против linked/remote project;
- deploy, push, PR merge, изменение Vercel/Supabase settings;
- `git reset`, `git clean`, `git checkout --`, удаление или восстановление пользовательских файлов;
- вывод `.env` или секретов в отчёты/логи;
- изменение `package.json`, lockfile или зависимостей;
- массовое форматирование и изменения вне file ownership;
- создание Studio/ProUp UI, CRM, billing, CAD/3D, procurement;
- назначение `human_confirmed` AI-процессом;
- скрытый impact без сохранённой graph edge.

## Протокол статуса

Каждый агент ведёт собственный файл:

```text
docs/product-intelligence/agent-runs/agent-N/STATUS.md
```

Обязательные поля:

```yaml
agent: agent-N
state: started | working | blocked | ready_for_review | complete
baseline_ref: <hash-or-unknown>
owned_paths: []
files_changed: []
contract_changes: []
validation_commands: []
validation_results: []
blockers: []
handoff_ready: true | false
snapshot_gate_observed: true | false
```

Agent 1 дополнительно записывает `snapshot_captured` и `snapshot_scope_hash`; Agent 2/3 только фиксируют, что увидели gate до своей первой записи.

Если агенту требуется изменение чужого файла, он создаёт `CHANGE_REQUEST.md` в своём run-каталоге. Сам файл не меняет.

## Параллельный граф

```text
START → Agent 1 snapshot ─┬─ Agent 1: baseline / migrations ─┐
                          ├─ Agent 2: pure domain contract ──┼─ Integrator
                          └─ Agent 3: contracts / fixtures ──┘
```

Agent 2 и Agent 3 ждут только `snapshot_captured: true`, но не ждут migration baseline, потому что работают в изолированных путях. Если snapshot не создан, они завершаются `blocked` до записи файлов. Никакая persistence/UI integration не начинается, пока Agent 1 не вернул `BASELINE_READY=true`.

## Завершение рабочего агента

`complete` допустим только если:

- создан полный набор deliverables своего ТЗ;
- проверены все изменённые файлы;
- перечислены точные команды и exit codes;
- отсутствуют изменения чужих путей;
- все неизвестные обозначены как unknown, а не угаданы;
- handoff содержит однозначное решение для Integrator.
