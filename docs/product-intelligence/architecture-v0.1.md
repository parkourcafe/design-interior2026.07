# Architecture v0.1

Дата фиксации: 16 июля 2026 года.

## 1. Цель

Создать общее `Project Intelligence Core`, которое хранит не только итоговые документы, но и проектную логику: источники, извлечённые факты, требования, допущения, решения, версии, согласования и вычислимое влияние изменений.

Ядро обслуживает две разные работы покупателя:

- `studio`: от разрозненного клиентского ввода до утверждённого scope и production handoff;
- `renovation`: от утверждённого дизайн-пакета до управляемого выполнения, сдачи и гарантии.

## 2. Архитектурная форма

На этапе product-market validation используется **модульный монолит**:

```text
Web application / API
├── Identity & Organizations
├── Projects & Areas
├── Sources & Ingestion
├── Project Graph
├── Review & Approvals
├── Versions & Change Impact
├── Deliverables & Exports
├── Studio workflow
├── Renovation workflow
└── Audit & Observability
        │
        ├── PostgreSQL / Supabase
        ├── Object Storage
        ├── Background jobs
        └── Region-specific AI adapters
```

Границы модулей существуют в коде и базе, но разворачиваются как одно приложение на регион. Микросервис выделяется только при подтверждённой операционной причине: независимое масштабирование, отдельный security boundary или отдельная команда-владелец.

## 3. Deployment cells

Один релизный артефакт разворачивается в независимых ячейках:

| Контур | Первая редакция | База | Object storage | Logs/backups | AI routing |
|---|---|---|---|---|---|
| `us` | ArchiDom Studio Edition | US | US | US | разрешённые US-провайдеры |
| `ru` | ProUp Renovation | RU | RU | RU | разрешённые RU-провайдеры |

Правила:

1. Проектные документы и их содержимое не реплицируются между ячейками.
2. Нет общей транзакционной базы пользователей и проектов.
3. Общими остаются код, миграции, обезличенные шаблоны и версии схем.
4. Центральная продуктовая аналитика, если появится, принимает только заранее утверждённые события без PII и содержимого проектов.
5. Регион задаётся deployment-конфигурацией и не переключается пользователем внутри существующего tenant.

## 4. Редакции

Редакция — не локализация и не условие в каждом компоненте. Это набор capability-модулей и собственная композиция journeys.

### Общие capabilities

- organization/project access;
- ingestion и immutable sources;
- Project Graph;
- provenance и human review;
- versions, approvals и audit;
- change-impact;
- templates и export jobs.

### `studio`

- branded intake;
- scope/inclusions/exclusions;
- risk and assumption register;
- fee proposal draft;
- decision ledger;
- deliverable matrix;
- FF&E/finish schedules;
- production handoff.

### `renovation`

- design-package completeness checks;
- room/trade WBS;
- estimate baseline;
- procurement states;
- substitutions;
- site reports;
- change orders;
- acceptance, handover and warranty archive.

Capabilities активируются на уровне organization через серверную policy. Клиентский UI не считается границей безопасности.

## 5. Модульные границы

| Модуль | Владеет | Не владеет |
|---|---|---|
| Identity | organizations, memberships, roles | project content |
| Projects | clients, projects, areas | source bytes, graph claims |
| Sources | source metadata, fragments, checksums | решения и требования |
| Project Graph | nodes, revisions, edges, evidence | файлы и экспортные binaries |
| Review | review actions, approvals | изменение истории ревизий |
| Versions | project versions, change sets, diffs | редакционные journeys |
| Impact | propagation policies, impact records | свободные LLM-догадки о влиянии |
| Deliverables | deliverable definitions, render jobs | accounting/procurement ledger |
| Studio | pre-sale и handoff orchestration | общие graph primitives |
| Renovation | execution orchestration | общие graph primitives |
| Audit | append-only security/domain events | бизнес-источник истины |

Модули вызывают друг друга через typed application services. Прямой импорт внутренних repository-реализаций другого модуля запрещён.

## 6. Основные технические правила

1. UUID — стабильная идентичность сущности; изменения создают ревизию, а не новую «копию без истории».
2. Каждый AI-вывод имеет provenance и статус проверки.
3. Источник и его fragment immutable; повторный импорт создаёт новую версию source при другом checksum.
4. Human confirmation всегда содержит actor и timestamp и не может быть выставлен AI-процессом.
5. Change-impact вычисляется по сохранённым связям графа и version diff. LLM может сформулировать объяснение, но не определяет сам список затронутых объектов.
6. Запрещены cross-project и cross-organization graph edges.
7. Все внешние операции идемпотентны: ingestion, extraction, export и webhook delivery имеют idempotency key.
8. Роли проверяются на сервере и в RLS; access token сам по себе не расширяет scope сверх конкретного ресурса.
9. Секреты, AI-провайдеры, storage и retention задаются на уровне deployment cell.
10. Миграции сначала additive. Удаление старых полей возможно только после backfill, dual-read периода и подтверждённого rollback plan.
11. Public access выдаётся через hashed, expiring и revocable grant; роль и participant выводятся на сервере из grant, а не принимаются как доверенный ввод клиента.
12. Деньги хранят ISO currency и minor units. Размер хранит исходное value/unit и нормализованное canonical value; форматирование — concern редакции/locale.
13. `SECURITY DEFINER` функции имеют фиксированный `search_path`, минимальные grants и явный `REVOKE` для недоверенных ролей.

## 7. Поток данных первого вертикального среза

```text
Upload
  → Source + checksum
  → Source fragments with locators
  → extracted/interpreted graph revisions
  → human review
  → project version V1
  → decision revision in V2
  → graph diff
  → deterministic dependency traversal
  → impact records
  → updated handoff export
```

## 8. Инфраструктура

Для P0 достаточно:

- Next.js application layer;
- Supabase/PostgreSQL с RLS;
- Supabase Storage или регионально допустимый S3-compatible storage;
- durable job table с `FOR UPDATE SKIP LOCKED` либо регионально допустимая очередь;
- provider adapters для extraction/LLM;
- structured logs с `region`, `organization_id`, `project_id`, `request_id`, но без сырого содержимого документов;
- error monitoring в соответствующем регионе.

Не вводить Kafka, event sourcing платформу, graph database или service mesh до измеренной необходимости. PostgreSQL adjacency tables и рекурсивные запросы достаточны для первого Project Graph.

## 9. Переход от текущего продукта

### Сохраняется

- Next.js/Supabase стек;
- intake и публичные token flows;
- deterministic passport/risk/pricing logic;
- human review pattern;
- proposal и print/export path;
- team/RLS groundwork;
- project-room как экспериментальный post-sale UI.

### Адаптируется

- `designers` → organization + membership;
- `projects.passport jsonb` → projection из versioned graph;
- `answers` и attachments → sources/fragments/evidence;
- `risk_cards.evidence text[]` → evidence links;
- proposal versions → project versions + deliverable revisions;
- project tasks → edition-specific execution nodes, связанные с decisions/items.
- legacy `project_rooms` → `project_workspaces`; физические помещения создаются отдельно как `areas`.

### Не переносится как основа ядра

- прямое использование JSONB-паспорта как единственного источника истины;
- привязка ownership только к `designer_id`;
- строковые ссылки `related_scope_item` без foreign key;
- AI-выводы без source locator;
- неверсированные обновления проектных сущностей.

## 10. Гейты изменения архитектуры

Architecture v0.1 можно менять через новый ADR. Обязательное основание хотя бы одно:

- сломан подтверждённый пользовательский workflow;
- невозможно выполнить data residency/security требование;
- измеренная нагрузка превышает возможности выбранной формы;
- два модуля не могут развиваться независимо из-за текущей границы;
- пилоты доказали другую каноническую сущность или связь.

Предпочтение команды или «на будущее может понадобиться» основанием не является.
