# ТЗ Agent 1 — Repository & Migration Integrity

## 1. Миссия

Восстановить достоверное знание о локальном репозитории и цепочке миграций, не потеряв пользовательские изменения и не изменив production. Итог — бинарный вывод:

```text
BASELINE_READY=true
```

или

```text
BASELINE_READY=false + исчерпывающий список блокеров
```

Agent 1 не проектирует Project Graph и не пишет новую migration.

## 2. Exclusive write scope

Разрешено создавать/менять только:

```text
docs/product-intelligence/agent-runs/agent-1/
├── STATUS.md
├── baseline-report.md
├── dataless-inventory.txt
├── git-state.md
├── migration-matrix.md
├── production-observation.md
├── bootstrap-report.md
├── security-review.md
└── proposed-migrations/
```

`proposed-migrations/` содержит копии/patch proposals, но не применяется к `supabase/migrations/`.

Разрешённые технические исключения, не считающиеся logical source edits:

- запрос iCloud materialization существующего файла без изменения байтов;
- защищённый snapshot в `/private/tmp/pi-project-intelligence-<UTC>/` с permissions `0700` для каталога и `0600` для artifacts.

## 3. Запрещённые действия

- запись в `supabase/migrations/**`;
- `git add`, `commit`, `push`, `restore`, `checkout`, `reset`, `clean`;
- изменение Git refs/index;
- удаление iCloud placeholders или замена их содержимым remote branch;
- любой SQL DDL/DML на production;
- создание временной production RPC;
- вывод URL, JWT, service-role key, database password;
- установка/обновление dependencies;
- запуск local reset против linked Supabase project.

## 4. Входы

Обязательно прочитать общие источники из `multi-agent/README.md` и дополнительно:

- `supabase/migrations/` — только чтение;
- `.git/HEAD`, refs и доступные Git objects — только чтение;
- `lib/project-room/**` и `lib/types.ts` — только чтение;
- `docs/product-intelligence/production-schema-observation-2026-07-16.md`.

Известные факты не считать окончательными без повторной проверки.

## 5. Рабочие пакеты

### A1.0 — Pre-wave snapshot gate

Выполнить до любой записи Agent 2/3:

1. Снять пути, size, flags и SHA-256 всех читаемых существующих файлов в write scopes Agent 2/3.
2. Отдельно отметить dataless/unreadable paths; не считать их hash-проверенными.
3. Если Git читается, сохранить в защищённый `/private/tmp` exact HEAD, porcelain-v2 status, staged/unstaged binary diffs и NUL-safe список non-ignored untracked files.
4. Не копировать секреты в отчёт. Raw snapshot остаётся вне repo; в отчёт попадают только path/hash/status и общий snapshot hash.
5. Записать в `STATUS.md`:

```yaml
snapshot_captured: true
snapshot_scope_hash: <sha256>
snapshot_git_state: captured | unavailable
```

`snapshot_captured=true` означает, что исходное состояние owned paths Agent 2/3 зафиксировано; это не означает, что Git baseline уже trustworthy. После сигнала Agent 2/3 могут писать параллельно, а Agent 1 продолжает audit. Если хотя бы существующий writable file Agent 2/3 невозможно прочитать или классифицировать, signal остаётся false и они не начинают запись.

### A1.1 — Dataless inventory

1. Посчитать dataless-файлы отдельно для:
   - Git metadata;
   - tracked/source/config files;
   - generated `.next`;
   - `node_modules`;
   - QA/media artifacts.
2. Не смешивать generated/dependency placeholders с блокирующими tracked files.
3. Запросить iCloud materialization только для Git metadata, tracked/source/config и non-ignored untracked files.
4. Повторять безопасный poll не дольше 60 секунд за один цикл.
5. Сохранить относительные пути и итоговые counts в `dataless-inventory.txt`.

Не считать файл восстановленным только по metadata size: содержимое должно читаться и иметь ненулевой hash там, где ожидается ненулевой файл.

### A1.2 — Git integrity

Проверить:

- читается ли `AGENTS.md`/`CLAUDE.md`;
- читается ли `.git/index`;
- читается ли packfile;
- выполняются ли `git status --short --branch`, `git log`, `git diff --stat`;
- какой exact local HEAD и upstream;
- есть ли uncommitted/staged/untracked files.

Если Git не читается, не регенерировать index и не заменять pack. Зафиксировать `BASELINE_READY=false` и продолжить только read-only migration evidence.

### A1.3 — Migration matrix

Для `0001…0009` создать таблицу:

| Migration | remote | local HEAD | worktree | production evidence | dependencies | status |
|---|---|---|---|---|---|---|

Для каждого доступного файла записать:

- filename;
- hash;
- создаваемые/изменяемые objects;
- prerequisite migration;
- destructive statements;
- RLS/policies/grants/functions;
- idempotency/rollback concerns.

Обязательно доказать зависимость `0009 → 0007` и отдельно классифицировать `0005`, `0008`, `0009`.

### A1.4 — Production read-only evidence

Разрешены только запросы, не читающие project rows и PII:

- OpenAPI table/column metadata;
- migration ledger через готовый read-only management/direct DB access;
- schema-only dump без данных и секретов.

Если `supabase_migrations` не экспонирована, записать `unknown`. Не обходить это созданием RPC или изменением grants.

Для каждого вывода указать уровень доказательства:

- `confirmed_by_ledger`;
- `confirmed_by_schema`;
- `inferred`;
- `unknown`.

Ledger и schema evidence сопоставляются независимо:

| Ledger | Schema | Classification |
|---|---|---|
| applied | expected objects complete | `applied` |
| absent | expected objects absent | `not_applied` |
| absent | objects present/partial | `diverged_manual` |
| applied | objects absent/partial | `diverged_ledger` |
| unknown | любое | `unknown` |

Schema-only observation не заменяет authoritative migration ledger для `BASELINE_READY=true`.

### A1.5 — Proposed repair, not applied repair

Если `0007` отсутствует в worktree:

1. извлечь exact version из local HEAD, если blob достоверно читается;
2. сохранить её только как `proposed-migrations/0007_project_rooms.sql`;
3. записать hash и origin commit;
4. сравнить с production-observed schema;
5. не копировать в рабочий migration folder.

Для `0008/0009` подготовить rollout order и rollback notes, но не применять.

### A1.6 — Clean bootstrap test

Разрешён disposable local Postgres/Supabase, не связанный с production.

Требования:

- connection target явно localhost/container;
- перед reset вывести только безопасный host/database label, без credentials;
- применить proposed continuous chain `0001…0009` на пустую БД;
- повторно применить idempotent migrations либо явно отметить, какие не предназначены для re-run;
- проверить наличие tables, constraints, indexes, RLS, policies и functions;
- сохранить только schema/test results, не database dump с данными.

Если Docker/Supabase CLI недоступны, bootstrap status = `not_run`, а не `passed`.

### A1.7 — Security review

Проверить:

- `SECURITY DEFINER` + fixed `search_path`;
- explicit `REVOKE/GRANT EXECUTE`;
- Data API table grants;
- RLS ownership через designer/studio;
- service-role use;
- public token storage/expiry/revocation;
- функции, принимающие actor role/participant ID;
- audit tables, каскадное удаление и append-only свойства;
- optimistic concurrency для task/version updates.

Каждая находка: severity, evidence path/line, consequence, proposed mitigation. Ничего не исправлять в этой волне.

## 6. Разрешённые команды

Примеры, не обязательный literal script:

```text
find / ls / stat / file / shasum
rg / sed
git status / log / diff / show / cat-file / ls-tree / fsck
brctl download
docker ps
local-only Supabase/Postgres commands после проверки target
read-only HTTP metadata probes
```

Нельзя использовать команду, если она может неявно писать в linked production.

## 7. Deliverables

### `baseline-report.md`

- exact baseline refs;
- какие файлы реально читаются;
- dataless blockers;
- итог `BASELINE_READY`;
- следующий безопасный шаг.

### `migration-matrix.md`

- полная матрица `0001…0009`;
- hashes/origins;
- production evidence levels;
- proposed continuous order.

### `bootstrap-report.md`

- environment;
- exact commands без секретов;
- exit codes;
- applied objects/assertions;
- failures и первая failing migration.

### `security-review.md`

- findings по severity;
- ссылки на файлы/строки;
- blocking/non-blocking classification.

## 8. Acceptance criteria

`BASELINE_READY=true` допустим только одновременно при выполнении всех условий:

- tracked source/config и Git metadata не dataless;
- `git status`, `log`, `diff` выполняются без corruption errors;
- dirty/staged/untracked state сохранён в отчёте;
- authoritative migration ledger получен и сопоставлен со schema-only evidence; неизвестных applied migrations нет;
- continuous `0001…0009` chain собрана как proposal;
- clean local bootstrap passed;
- production не изменялась;
- Agent 1 не менял чужие пути.

Если любое условие не выполнено, итог `BASELINE_READY=false`. Это нормальное завершение, если блокеры и следующий шаг исчерпывающе описаны.

## 9. Handoff contract

В `STATUS.md` добавить:

```yaml
baseline_ready: true | false
snapshot_captured: true | false
snapshot_scope_hash: <sha256-or-unknown>
local_head: <hash-or-unknown>
worktree_trustworthy: true | false
migration_chain_complete: true | false
ledger_obtained: true | false
ledger_schema_consistent: true | false
production_0007: confirmed | inferred | unknown
production_0008: confirmed | inferred | unknown
production_0009: confirmed | inferred | unknown
bootstrap: passed | failed | not_run
database_changes_allowed_next_wave: true | false
```

Agent 2/3 не зависят от `database_changes_allowed_next_wave`. Integrator и все persistence-агенты зависят.
