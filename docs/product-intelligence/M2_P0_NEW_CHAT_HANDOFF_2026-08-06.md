# ArchiDom M2 P0 — handoff для нового чата

Дата фиксации: 2026-08-06

Статус: циклы 1–6 завершены; цикл 7 ожидает реальный внешний пакет

Ветка: `codex/archidom-m2-p0-integration`

Стек PR: поверх `codex/ap1-migration-chain-reconciliation` / draft PR #62

Последний implementation checkpoint до этого handoff: `3337b39`

## 1. Цель, которую нельзя сужать

Интегрированный M2 P0 для одной комнаты:

```text
Contracted Project Passport
→ ровно 3 Design Intent варианта
→ реальные selections + supplier/price/provenance
→ детерминированный бюджет в RUB
→ отдельное человеческое клиентское согласование
→ immutable Approved Design Intent + Approved Selections
→ exact-version handoff в M3
```

Семь обязательных циклов:

1. Domain-контракт трёх вариантов.
2. Selections, prices, provenance и budget.
3. Human approval и immutable M2 commit.
4. Authenticated persistence, commands и RLS.
5. Layout Studio через серверный Project Package repository.
6. Отдельный client review и exact M2→M3.
7. Kora + один внешний реальный пакет через одинаковые contracts.

Каждый цикл выполняется через Agent Loop:

```text
RED → GREEN → REFACTOR/security review → full gates → evidence/report
```

Не расширять scope в CAD/BIM, широкий AI router, credits, marketplace,
production deployment или production adoption.

## 2. Продуктовый и архитектурный контекст

- Публичный продукт: **ArchiDom**.
- `ProjectCEO` остаётся internal compatibility namespace migrations/RPC/API/TS.
- Активный контракт:
  - `docs/product-intelligence/ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md`;
  - `docs/product-intelligence/wave-3/MASTER_EXECUTION_PLAN.md`;
  - `docs/product-intelligence/architecture-v1.md`;
  - `docs/product-intelligence/adr/0004-one-archidom-four-workspaces.md`.
- Runtime приложения не получает прямой доступ к private Project Intelligence tables.
- Human operations выполняются request-bound JWT/PostgREST, не service role.
- Actor/organization/project/package/role/timestamps выводятся server-side.
- M2/M3 snapshots append-only, exact-version и audit-linked.
- Kora — полноразмерный эталон около 1 800 м², не единственная допустимая форма данных.

## 3. Что реализовано

### Цикл 1 — три контролируемых Design Intent варианта

Завершён.

- Room-scoped aggregate.
- Ровно `preferred`, `value_engineered`, `premium`.
- Exact Layout Document/Version/semantic hash.
- Scope, role uniqueness, immutable publication и revision reason validation.

Основные файлы:

- `lib/project-intelligence/modules/design-intent/`;
- `tests/project-intelligence/contracts/m2-room-design-intent.contract.test.ts`.

### Цикл 2 — selections, price provenance и budget

Завершён.

- Exact selection revisions.
- Supplier/source/evidence provenance.
- Price observations с датой и integer RUB.
- Детерминированный budget и stale/missing warnings.
- Cross-scope и replacement revision negatives.

Основные файлы:

- `lib/project-intelligence/modules/design-intent/budget.ts`;
- `tests/project-intelligence/contracts/m2-selection-budget.contract.test.ts`.

### Цикл 3 — human approval и immutable M2 commit

Завершён.

- Designer submit и отдельный human client review.
- Reviewer отличается от фактического submitter.
- AI/system не может утверждать.
- Commit повторно проверяет exact layout/selections/budget и chronology.
- Deep immutable Approved Design Intent/Selections snapshot.

Основные файлы:

- `lib/project-intelligence/application/m2-approval/`;
- `tests/project-intelligence/application/m2-approval-commit.test.ts`.

### Цикл 4 — authenticated persistence, commands и RLS

Завершён.

- Strict `commit_m2_approval` command.
- Request-bound dispatch.
- Additive immutable approved-commit ledger.
- Read projection, audit, idempotency, append-only/stale protection.
- PG16/PG17, RLS, cross-tenant/package, concurrency и restart replay.

Основная migration:

- `supabase/migrations/20260802070000_projectceo_m2_approved_commits.sql`.

### Цикл 5 — Layout Studio authenticated repository

Завершён.

- Pure Layout Studio domain сохранён без CAD/BIM/browser-local production path.
- Authenticated Project Package repository port и HTTP adapter.
- `GET/POST /api/projectceo/projects/[projectId]/layouts`.
- Exact Layout Document validation, canonical SHA-256, immutable revision history.
- Optimistic parent revision, first-publication semantics, replay/concurrency.
- Builder redaction и sibling package/room isolation.

Основные файлы:

- `lib/layout-studio/application/layout-repository.ts`;
- `lib/layout-studio/adapters/http/authenticated-layout-repository.ts`;
- `app/api/projectceo/projects/[projectId]/layouts/route.ts`;
- `supabase/migrations/20260802080000_projectceo_m2_layout_versions.sql`.

### Цикл 6 — client review и exact M2→M3

Завершён.

- Отдельная package-assigned русская client review panel.
- Ровно три exact варианта, selections, budget и price warnings.
- `approved`, `change_requested`, `rejected` с обязательной причиной.
- Dirty chosen variant нельзя approve.
- Designer authoring скрыт от client/builder/guest.
- Dedicated commands:
  - `submit_m2_client_review`;
  - `review_m2_client_submission`;
  - `publish_m2_m3_handoff`.
- Read v6 с exact nested fail-closed DTO.
- Server-side authoritative validation selection/approval/design intent/price provenance.
- Budget пересчитывается из authoritative price observations.
- Client review атомарно создаёт canonical Approved Commit через штатный append/audit path.
- Generic append не может создать commit до review, подменить payload или записать revision 2.
- M3 принимает только persisted exact handoff, включая approved commit revision,
  layout revision, selection revisions и budget.

Основные файлы:

- `components/projectceo/m2-client-review-panel.tsx`;
- `components/projectceo/m2-m3-approved-input-card.tsx`;
- `components/projectceo/m2-cycle6-command-builders.ts`;
- `lib/project-intelligence/application/m2-to-m3-handoff/`;
- `supabase/migrations/20260802090000_projectceo_m2_client_review_m3_handoff.sql`;
- `tests/db4/33_m2_client_review_m3_handoff_operations.sql`.

### Цикл 7 — безопасный intake/evidence gate

Infrastructure gate реализован, но сам цикл **не завершён**.

- Kora закреплена как full project 1 800 м² с одной explicit room/package scope.
- Synthetic `kitchen-worktop` запрещён как внешнее evidence.
- Typed external manifest validator.
- Two-phase `prepare → execute → finalize`.
- Git-tracked allowlisted producer/executor identity + exact SHA-256.
- Challenge nonce.
- Five distinct request-bound role/session/request bindings.
- Exact command/state/replay/audit/read/lineage receipts.
- Раннер вызывает Kora producer и валидирует его protected receipt: обвязка
  проверена, сам producer добавлен отдельно (см. ниже).
- Finalizer перечитывает persisted PENDING и Kora receipt, проверяет digests и scope.
- PASS публикуется только atomic rename последней операцией.
- Failure cleanup удаляет PASS/temp/receipts.
- Token/path/private filename privacy guards.
- Current external executor честно возвращает pending и не создаёт evidence.

Основные файлы:

- `tests/fixtures/cycle7/kora-one-room-pilot.json`;
- `tests/pilot-evidence/run-m2-pilot-evidence.zsh`;
- `tests/pilot-evidence/m2-pilot-evidence-contract.ts`;
- `tests/pilot-evidence/finalize-m2-pilot-evidence.ts`;
- `tests/pilot-evidence/executors/allowlist.json`;
- `tests/pilot-evidence/executors/pending-external-system.zsh`.

### Kora five-session producer (добавлен 2026-08-06)

- `tests/pilot-evidence/executors/kora-five-session-producer.zsh` — repository-owned
  producer: запускает реальный `tests/ap1/e2e/run-five-sessions.zsh`, собирает
  идентификаторы этого прогона и вызывает builder. Ничего не выдумывает.
- `tests/pilot-evidence/kora-five-session-receipt.ts` — тестируемый builder:
  маппинг AP1-ролей на Cycle 7 (`owner→owner_lead`, `client→client_approver`),
  строгая RFC-4122 проверка, пять различных bindings, приватность, запись `wx`/0600.
- `tests/pilot-evidence/kora-five-session-receipt-cli.ts` — CLI для producer'а.
- `tests/pilot-evidence/kora-five-session-receipt.test.ts` — 23 теста, включая
  интеграционный: receipt проходит через реальный `finalizeM2PilotEvidence` до PASS.

Источники идентификаторов — только фактический прогон: `userId` из session-файла
AP1, `sessionId` из `auth.sessions` disposable-базы, `requestId` из ответа живого
аутентифицированного `GET /api/projectceo/portfolio` под cookie-jar той же роли.

**Producer намеренно НЕ добавлен в allowlist** — это должен сделать независимый
ревьюер (см. §8).

Попутно исправлен дефект самого раннера: `local status=$?` в `cleanup()` —
в zsh `status` read-only, из-за чего trap обрывался на первой строке и
failure-cleanup не удалял PENDING/RECEIPT/KORA_RECEIPT. Воспроизведено на zsh 5.9,
исправлено в обоих скриптах, покрыто регрессионным тестом; digest раннера в
`allowlist.json` обновлён под исправленный файл.

## 4. Доказательства и проверки

Последний полностью зелёный Cycle 6 repository gate:

```text
Vitest:          98 files / 781 tests PASS
TypeScript:      PASS
ESLint:          0 errors, 12 existing warnings
Next build:      PASS
PostgreSQL 16:   DB4 + DB33 + concurrency + restart replay PASS
PostgreSQL 17:   DB4 + DB33 + concurrency + restart replay PASS
Security review: CLEAR
UI review:       CLEAR
```

Cycle 7 intake gate:

```text
Identity tests:    10/10 PASS
Adversarial tests:  7/7 PASS
Contract tests:     6/7 PASS
Typecheck:          PASS
Targeted ESLint:    PASS
```

Единственный intentional RED:

```text
CYCLE7_EXTERNAL_MANIFEST_REQUIRED
```

Без external input runner завершает работу:

```text
exit 66
external.status = "not_supplied"
productionChanged = false
```

Нельзя объявлять весь repository suite зелёным, пока Cycle 7 manifest отсутствует:
новый pilot contract намеренно красный. Последний зелёный общий suite относится к
закрытому Cycle 6 checkpoint.

## 5. Коммиты текущего M2 стека

От base `origin/codex/ap1-migration-chain-reconciliation`:

```text
77c09af feat(m2): add exact design approval contracts
2023798 feat(m2): persist exact approved design commits
aa4655d feat(m2): define authenticated layout version contract
bf5e058 feat(m2): persist authenticated layout versions
82ed0e9 feat(m2): define exact client review and m3 handoff
e77ad36 feat(m2): persist exact client review and m3 handoff
87a3df2 feat(m2): add authenticated client review and m3 ui
fac3e4e test(m2): add fail-closed external pilot gate
40a5feb docs(m2): hand off p0 agent loop
```

Хеши актуальны после rebase на base commit `01d76e5` от 6 августа 2026 года.

## 6. Что не сделано

Cycle 7 и полный M2 P0 не завершены. Блокеров четыре, а не один:

1. **Внешний реальный пакет** — не предоставлен (см. §7).
2. **Внешний executor** — единственный allowlisted (`pending-external-system.zsh`)
   честно отдаёт exit 75 без receipt. Нужен реальный, с доступом к disposable
   окружению, после RED/GREEN/REFACTOR и независимого review.
3. **Kora producer не в allowlist** — скрипт написан и покрыт тестами, но
   раннер отклонит его до добавления записи ревьюером (§8).
4. **Среда прогона** — Cycle 7 привязан к рабочей станции владельца:
   `tests/ap1/e2e/run-five-sessions.zsh` требует
   `DOCKER_HOST=unix://$HOME/.colima/archidom-ap1/docker.sock` и отвергает любой
   другой (`AP1_DOCKER_HOST_REJECTED`, exit 65), плюс `AP1_KORA_SITE_PHOTO` и
   локальный Supabase. В удалённой сессии/CI прогон невозможен.

В workspace проверены существующие кандидаты на внешний пакет:

- `fixtures/project-intelligence/kitchen-worktop` — явно `synthetic: true`;
- `Ubud Food Hall - MEP Existing.pdf` — тот же Kora/Ubud контур;
- Kora sources дают layout provenance, но не независимые три коммерческих варианта
  с реальными supplier price observations.

Запрещено:

- переименовать synthetic fixture и выдать его за внешний;
- самостоятельно придумать suppliers/prices/provenance;
- считать Kora вторым проектом;
- создавать fake receipt или PASS;
- повышать verdict до `PILOT_READY`/`PRODUCTION_READY` без реального run.

## 7. Что нужно получить от пользователя

Один обезличенный внешний пакет реального клиента/партнёра:

1. Одна комната.
2. Три фактических варианта планировки (PDF/image/export достаточно; CAD не нужен).
3. Selections/materials/items для каждого варианта.
4. Supplier/reference, integer price в RUB и дата наблюдения.
5. Источник каждого подбора/цены: документ, ссылка или фрагмент.
6. Файлы или checksums для provenance.
7. Неперсональное название проекта/комнаты.

Пользователю не нужно вручную строить JSON manifest. После получения файлов новый
чат должен:

1. Скопировать данные только в безопасный working/intake location, не public assets.
2. Выполнить privacy scan и вычислить SHA-256.
3. Создать sanitized manifest вне production/private public paths.
4. Реализовать/allowlist repository-owned external executor для disposable environment.
5. Запустить Kora producer + внешний executor через пять request-bound sessions.
6. Получить machine receipts и atomic PASS.
7. Повторить PG16/17, browser/RLS, full gates на одном финальном commit.
8. Провести requirement-by-requirement completion audit.
9. Только после доказательств закрыть Cycle 7 и вынести `PILOT_READY` или `NO_GO`.

## 8. Точная следующая команда после появления данных

Сначала ревьюер добавляет producer в allowlist (одна запись; digest считается
командой ниже, потому что после любой правки скрипта он меняется):

```bash
shasum -a 256 tests/pilot-evidence/executors/kora-five-session-producer.zsh \
  | awk '{print "sha256:"$1}'
```

```json
{
  "path": "tests/pilot-evidence/executors/kora-five-session-producer.zsh",
  "digest": "sha256:<вывод команды выше>"
}
```

Затем, после создания reviewed и git-tracked external executor:

```bash
ARCHIDOM_EXTERNAL_PILOT_MANIFEST=/absolute/private/path/external-manifest.json \
ARCHIDOM_EXTERNAL_PILOT_EXECUTOR=/absolute/repo/path/tests/pilot-evidence/executors/<executor>.zsh \
ARCHIDOM_EXTERNAL_PILOT_EXECUTOR_SHA256=sha256:<reviewed-digest> \
ARCHIDOM_KORA_FIVE_SESSION_PRODUCER=/absolute/repo/path/tests/pilot-evidence/executors/kora-five-session-producer.zsh \
ARCHIDOM_KORA_FIVE_SESSION_PRODUCER_SHA256=sha256:<digest из команды выше> \
zsh tests/pilot-evidence/run-m2-pilot-evidence.zsh
```

Прогон возможен только на машине с профилем Colima `archidom-ap1` и поднятым
disposable Supabase; `AP1_KORA_SITE_PHOTO` должен быть читаем.

Не добавлять executor в allowlist до RED/GREEN/REFACTOR и независимого review.

## 9. Git/PR handoff

- Working tree опубликован clean.
- Текущая ветка: `codex/archidom-m2-p0-integration`.
- Remote: `parkourcafe/design-interior2026.07`.
- Draft PR создан: `https://github.com/parkourcafe/design-interior2026.07/pull/66`.
- Base PR #66 — `codex/ap1-migration-chain-reconciliation`; это stacked work поверх
  draft PR #62. После rebase GitHub показывает PR #66 как `MERGEABLE`.
- Vercel check PR #66 красный из-за project collaboration/access configuration,
  а не из-за обнаруженной ошибки build. Supabase Preview пропущен; Vercel Preview
  Comments зелёный. Нужна отдельная настройка прав Vercel владельцем проекта.
- После merge PR #62 нужно rebase/retarget текущий M2 PR на актуальную default/main
  ветку и повторить CI.

## 10. Готовый промпт для нового чата

Скопировать в новый чат:

```text
Продолжи активный ArchiDom M2 P0 Agent Loop из ветки
codex/archidom-m2-p0-integration.

Сначала полностью прочитай:
1) AGENTS.md;
2) docs/product-intelligence/M2_P0_NEW_CHAT_HANDOFF_2026-08-06.md;
3) docs/product-intelligence/M2_COMPLETION_AGENT_LOOP_PLAN_2026-08-06.md;
4) .tdd-state.json;
5) Product Charter v0.4, architecture-v1 и ADR-0004.

Не переделывай циклы 1–6: они завершены и имеют PG16/PG17, concurrency,
restart replay, full repo и независимый security/UI review evidence.

Текущий активный цикл — M2-070. Единственный intentional RED:
CYCLE7_EXTERNAL_MANIFEST_REQUIRED. Не заменяй внешний реальный пакет Kora или
synthetic kitchen-worktop fixture и не создавай fake prices/provenance/receipts.

Если пользователь приложил внешний пакет, выполни:
privacy scan → SHA-256 → sanitized manifest → isolated RED → repository-owned
executor GREEN → REFACTOR/security review → Kora + external five-session run →
machine receipts → atomic PASS → PG16/17/browser/RLS/full gates → completion audit.

Если внешний пакет не приложен, не объявляй M2 завершённым. Зафиксируй, какие
именно данные отсутствуют, и запроси одну комнату, 3 варианта, selections,
supplier/RUB/date и source provenance.

Не строить CAD/BIM, broad AI router, credits, marketplace или production deploy.
```

## 11. Текущий verdict

08.08.2026 по решению владельца выполнен прогон продукта на предоставленной
смете (студия 40 м², СПб) — см. `M2_PRODUCT_RUN_REPORT_2026-08-08.md`.
Доменное ядро M2 отработало от трёх вариантов до неизменяемого коммита, 6/6.
Фикстура помечена синтетической; цикл 7 остаётся открытым, вердикт ниже
не меняется.

```text
M2 cycles 1–6: COMPLETE
Cycle 7 intake gate: CLEAR / READY TO RECEIVE EVIDENCE
Kora real execution for Cycle 7: NOT PROVEN ON FINAL GATE
External real package: NOT SUPPLIED
Overall M2 P0: INCOMPLETE
Production adoption: NOT AUTHORIZED
```
