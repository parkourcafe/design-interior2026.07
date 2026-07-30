# Исполняемое ТЗ для Codex

Для параллельного выполнения двумя или тремя агентами использовать отдельный пакет: [`multi-agent/README.md`](./multi-agent/README.md). Он имеет приоритет в вопросах file ownership, handoff и merge gates; архитектурные решения остаются в этом документе и ADR.

## Общие правила задачи

Каждая задача:

- имеет один проверяемый outcome;
- перечисляет зависимости и изменяемые модули;
- не меняет соседний workflow без acceptance test;
- использует additive migration;
- добавляет unit/integration tests;
- обновляет этот пакет, если меняет архитектурный контракт;
- завершается командами `lint`, `typecheck`, `test`, `build` либо явной фиксацией внешнего блокера.

Нельзя объединять schema migration, полный UI redesign и смену AI-провайдера в одну задачу.

## Эпик E0 — Restore trustworthy baseline

### PI-001: Materialize and protect repository

Outcome: все tracked files и `.git` доступны локально; `git status` выполняется без ошибок.

Acceptance:

- отсутствуют tracked `dataless` placeholders;
- создана backup branch/tag локального HEAD;
- зафиксирован список uncommitted files;
- никакие uncommitted изменения не потеряны.

### PI-002: Reconcile database history

Зависит от PI-001.

Outcome: Git migrations сопоставлены с production schema.

Acceptance:

- schema-only dump сохранён как audit artifact без данных/секретов;
- migrations 0007/0008/0009 классифицированы: applied/not applied/diverged;
- отсутствующий в worktree `0007` восстановлен до запуска зависящей от него `0009`;
- следующая migration number выбрана без коллизии;
- bootstrap всех migrations проверен на пустой database;
- Data API grants и `SECURITY DEFINER` execute privileges заданы явно;
- составлен rollback plan.

## Эпик E1 — Domain foundation

### PI-010: Adopt graph domain contracts

Outcome: `lib/project-intelligence` является единственным публичным контрактом graph primitives.

Acceptance:

- node/status/edge types экспортируются через public index;
- invariants покрыты тестами;
- impact traversal deterministic и cycle-safe;
- модуль не зависит от UI/Supabase/AI provider.

### PI-011: Organization ownership design

Зависит от PI-002.

Outcome: additive schema для organizations/memberships с backfill из designers/studio_members.

Acceptance:

- каждый существующий project получает organization_id;
- старый designer flow продолжает работать;
- RLS regression tests покрывают owner/member/non-member;
- cross-organization access запрещён.

### PI-012: Separate workspace from physical areas

Зависит от PI-002, PI-011.

Outcome: legacy `project_rooms` больше не конфликтует с физическим Room/Area.

Acceptance:

- collaboration aggregate получает имя `project_workspaces` в domain и schema compatibility plan;
- `project_areas` поддерживает parent hierarchy и stable key;
- ни один legacy route/token не теряет доступ при переименовании;
- task links больше не используют свободный `related_scope_item` для новых записей.

## Эпик E2 — Source provenance

### PI-020: Source and fragment schema

Зависит от PI-011, PI-012.

Outcome: immutable source metadata и addressable fragments.

Acceptance:

- checksum dedupe scoped to project;
- locator schemas для PDF/transcript/image/spreadsheet;
- storage bytes не пишутся в database/logs;
- source deletion использует retention policy и audit event.

### PI-021: Ingestion adapter

Зависит от PI-020.

Outcome: текущий upload/plan extraction пишет Source/Fragment, не ломая answers.

Acceptance:

- dual-write feature flag;
- повторный job идемпотентен;
- failed extraction сохраняет status/error code без сырого документа в log;
- существующий intake regression suite зелёный.

## Эпик E3 — Versioned graph

### PI-030: Graph persistence

Зависит от PI-011, PI-020.

Outcome: nodes, revisions, evidence and edges сохранены с RLS.

Acceptance:

- database constraints обеспечивают same-project references;
- published revision не обновляется in place;
- AI claim без evidence отклоняется, кроме `unknown` с reason;
- human status требует authenticated human actor.

### PI-031: Passport projection

Зависит от PI-030.

Outcome: существующий Passport можно воспроизвести из graph без смены текущего UI.

Acceptance:

- golden fixtures сравнивают old/new projection;
- расхождения выводятся в audit report;
- read switch остаётся feature-flagged;
- rollback возвращает старый JSONB read path.

### PI-032: Review UI

Зависит от PI-030.

Outcome: человек видит claim рядом с source fragment и подтверждает конкретную revision.

Acceptance:

- confirm/reject/edit создают audit events;
- stale revision нельзя подтвердить после появления новой;
- source locator открывается в нужном месте;
- keyboard/mobile baseline проверен.

## Эпик E4 — Versions and impact

### PI-040: Project versions and change sets

Зависит от PI-030.

Outcome: publish V1, edit decision, create V2 and field-level diff.

Acceptance:

- version numbers unique/monotonic per project;
- published version immutable;
- reason обязателен для изменения confirmed decision;
- rollback создаёт новую version.

### PI-041: Persisted change-impact

Зависит от PI-010, PI-040.

Outcome: pure impact engine интегрирован с persisted graph/version pair.

Acceptance:

- path воспроизводится по edge ids;
- один change set не создаёт duplicate impacts;
- cycle/cross-project/non-propagating tests;
- impacts имеют review lifecycle.

## Эпик E5 — Handoff

### PI-050: Versioned handoff export

Зависит от PI-032, PI-041.

Outcome: PDF/XLSX/CSV или HTML-print artifact содержит confirmed scope, evidence references, version и unresolved impacts.

Acceptance:

- content hash и generation status сохраняются;
- export одной версии воспроизводим;
- tenant branding не смешивается между organizations;
- US unit/currency formatting отделено от canonical values.

## Параллельность

После PI-002 могут параллельно идти:

- PI-010 (pure domain);
- PI-011 (ownership schema);
- подготовка fixtures и pilot documents без PII.

После PI-030 могут параллельно идти PI-031 и PI-032. PI-040 начинается после стабильной revision model. PI-050 начинается после подтверждённого impact contract.

Два агента не меняют одну migration или один public domain contract одновременно.
