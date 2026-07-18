# ProjectCEO RU — Kora Local Pilot-Ready Report

Дата: 18 июля 2026 года.
Accepted baseline: `9874524c39199386d042a24c0d50908b966fec4d`.
Thin M4 accepted: `e74f4b34e169a3397c0d2f4c3191576d131eb65d`.
Public-manifest retirement: `1c803b0`.
Request-bound layer accepted: `a8c86a81b7305210b71e1d790fcefa11e5920571`.
Область: локальный ProjectCEO RU P0; production не изменялся.

```text
KORA_FULL_PROJECT=true
KORA_AREA_M2=1800
DETERMINISTIC_PILOT_HARNESS=true
M2_M3_ACCEPTED_LOCAL=true
M4_ACCEPTED_LOCAL=true
REQUEST_BOUND_LAYER_ACCEPTED_LOCAL=true
REQUEST_BOUND_BACKEND_E2E=pending
SANITIZED_BROWSER_QA=pass
AUTHENTICATED_BROWSER_QA=pending
PRODUCTION_READY=false
PRODUCTION_APPLIED=false
```

## 1. Вердикт

ProjectCEO имеет воспроизводимый локальный Kora vertical slice от source registry
до handover closure. Fresh DB5 replay 18 июля прошёл PostgreSQL 16 и 17, включая
release-after-impact gate, concurrency и restart replay.

Локальный pilot core считается **READY FOR INTEGRATION QA**:

- Kora остаётся одним проектом около 1 800 м²;
- 5 packages, из них 4 work packages, являются scoped views одного Project;
- 209 физических записей сохраняются как `81 materialized + 128 placeholders`;
- exact source revision используется как evidence;
- решения и selections проходят human approval;
- ProjectBaseline V1/V2 и ProductionPackageVersion immutable;
- release связан с exact package version и semantic hash;
- distribution и acknowledgement связаны с exact release;
- ChangeRequest содержит причину, инициатора, `+180 000 RUB`, `+2 days`;
- traversal ограничен глубиной 3 и создаёт 3 deterministic impacts;
- все impacts имеют human disposition;
- no-change завершён отдельным human-approved terminal;
- photo/milestone/warranty closure отклоняет неполный и принимает полный handover;
- builder/client/guest не получают запрещённые cross-role/cross-package действия.

Статус **не** повышается до authenticated pilot application ready, пока не
будут закрыты оставшиеся read/command contracts и authenticated browser QA.

## 2. Исполнимый эталонный сценарий

Источник данных:

- `fixtures/project-intelligence/kora/kora-project-brain-golden.json`;
- `fixtures/project-intelligence/kora/kora-pilot-scenario.json`.

Исполнение:

```text
sanitized 209-record source inventory
→ exact-hash source/package registry
→ exact evidence
→ Requirement + Assumption + Decision + Selection V1
→ human ApprovalPackage V1
→ immutable ProjectBaseline V1
→ root + architecture + engineering package versions
→ explicit approved no-change for engineering
→ Selection V2 with reason
→ human ApprovalPackage V2
→ immutable ProjectBaseline V2
→ root + architecture package V2
→ deterministic release
→ exact architecture distribution + acknowledgement
→ ChangeRequest V1 → V2
→ depth-capped impact traversal
→ three human dispositions
→ two milestones / three accepted areas / three accepted photos
→ warranty document
→ construction handover closure
```

Отрицательные ветки:

- revision вне baseline отклоняется при сборке work package;
- incomplete photo closure отклоняется;
- builder не публикует release;
- client не распределяет release;
- guest не review-ит source;
- guest читает только exact granted package и не читает sibling package.

## 3. Детерминированные результаты

```text
Physical records       209
Materialized            81
Placeholders            128
Unique blobs             28
Duplicate groups         18
Semantic conflicts        8
Packages                  5
Work packages             4
Impact roots              1
Impacts                    3
Human dispositions         3
Accepted areas             3
Accepted photos            3
Warranty documents         1
```

Exact hashes:

```text
Baseline V1  sha256:d5d10c5933668753f8c1c733caca74d8d4b49e3e8f9adec57481d4537a52d906
Baseline V2  sha256:c80dbe32f680621b153a4b3ffa6f35948d23f2c871460ee5550884fddb8c5f49
Root release sha256:9f229b61ef24d4258e174c9b5bad9a700e1bdf367d2b3c8b8f0745ec681d4fd8
```

Повторный run создаёт равный evidence object. Старый baseline после V2 не
изменяется.

## 4. Команды и фактический результат

Выполнено 18 июля 2026 года:

```bash
./node_modules/.bin/vitest run tests/projectceo-e2e/kora-pilot.e2e.test.ts
# PASS — 1 file / 3 tests

./node_modules/.bin/tsx tests/projectceo-e2e/run-kora-pilot.ts
# PASS — deterministic JSON evidence; productionChanged=false
```

Повторяемая fast-команда:

```bash
zsh tests/projectceo-e2e/run-local.zsh
```

Полный DB harness:

```bash
zsh tests/projectceo-e2e/run-db.zsh
```

Он последовательно запускает DB5 на `postgres:16-alpine` и
`postgres:17-alpine`.

Fresh result 18 июля 2026 года:

```text
PostgreSQL 16  PASS
PostgreSQL 17  PASS
RLS / ACL      PASS
release gate   PASS — premature denied, reviewed release accepted
root coverage  PASS — every change root reaches reviewed impact coverage
concurrency    PASS
rollback       PASS
restart replay PASS
adapter/static PASS — 8/8
terminal       KORA_PILOT_DB_OK pg16=true pg17=true production_changed=false
```

Harness доказал обязательный порядок:

```text
Baseline V2
→ ChangeRequest
→ calculate impact
→ human review всех impacts
→ ProductionPackageVersion V2
```

Fresh exit code: `0`.

Combined scoped Vitest:

```bash
./node_modules/.bin/vitest run \
  tests/db5/adapter-contract.test.ts \
  tests/db5/static-boundary.test.ts \
  tests/projectceo-e2e/kora-pilot.e2e.test.ts
# PASS — 3 files / 11 tests
```

Request-bound application `a8c86a8`, только local static/unit/early-handler
evidence:

```bash
./node_modules/.bin/vitest run tests/projectceo-integration
# PASS — 5 files / 28 tests

./node_modules/.bin/vitest run tests/projectceo-integration tests/projectceo-ui
# PASS — 10 files / 54 tests

npm run typecheck
# PASS
```

Final scoped application/persistence run на текущем shared tree:

```bash
./node_modules/.bin/vitest run \
  tests/db5/adapter-contract.test.ts \
  tests/db5/static-boundary.test.ts \
  tests/projectceo-e2e/kora-pilot.e2e.test.ts \
  tests/projectceo-integration \
  tests/projectceo-ui
# PASS — 13 files / 65 tests
```

`git diff --check` также PASS.

Этот PASS проверяет fail-closed fixture mode, request identity, strict command
schema, DTO sanitization и orchestration на fake clients. Он не создаёт реальную
authenticated Supabase session, не вызывает hosted PostgREST и не заменяет
browser QA; поэтому `REQUEST_BOUND_BACKEND_E2E` остаётся `pending`.

Guest fixture ограничен одним exact package: global/source inventory обнулён,
`packageCount=1`, handover скрыт. Все fixture mutations визуально unavailable;
это локальная sanitization evidence, а не RLS evidence.

### Локальный sanitized browser QA

Пять non-production fixture routes проверены вручную в browser:

- owner, architect, builder, client и guest отображают один Kora Project;
- role tab matrix соответствует capabilities; owner прошёл все 8 tabs;
- synthetic mutations и participant revoke отключены;
- guest имеет только Overview/Releases exact package и не получает full-project
  source counters, handover, participants, audit или sibling package metadata;
- desktop walkthrough чист; на mobile `390×844` owner и guest имеют
  `document/body scrollWidth=390`, горизонтального page overflow нет;
- browser console error/warning logs пусты.

Метаданные evidence: 18 июля 2026 года, примерно `11:14–11:27 UTC`;
Next `16.2.10` dev/webpack; `http://localhost:3100/projectceo-qa/[role]`;
изолированная rsync-копия shared tree в `/private/tmp/projectceo-browser-qa`,
чтобы исключить iCloud Watchpack issue. Screenshots/trace не сохранялись:
evidence основан на ручной проверке DOM, tabs, viewport и browser logs.

Это `SANITIZED_BROWSER_QA=pass` для deterministic fixture без Supabase session.
Он не вызывает hosted PostgREST, не проверяет RLS/Auth/SMTP и не меняет
`AUTHENTICATED_BROWSER_QA=pending`.

## 5. Evidence levels

| Слой | Статус | Что доказано | Что не доказано |
|---|---|---|---|
| Sanitized fixture | PASS | full-project scale, package hierarchy, safe identifiers | реальные production bytes не читаются |
| Pure/application E2E | PASS | exact evidence, approvals, versions, release, change, closure, negatives | request session и DB grants не участвуют |
| DB4 M2/M3 | PASS на accepted `9874524` | persistence, forced RLS, RPC/ACL, concurrency, replay | production clone не прогнан |
| DB5 M4 | PASS fresh PG16/PG17 на `e74f4b3` | M4 persistence, human/worker split, reviewed release gate, closure, replay | production clone pending |
| Request-bound server | ACCEPTED PARTIAL LOCAL на `a8c86a8` | fail-closed identity, read routes, strict commands, sanitization и early handler paths зелёные | live Auth/PostgREST E2E не пройден; обязательные команды остаются unavailable |
| Sanitized browser | PASS LOCAL | пять fixture roles, exact guest projection, desktop/mobile, console clean | нет Supabase session, hosted PostgREST или RLS evidence |
| Authenticated browser | PENDING | runbook определён | реальный owner/architect/builder/client/guest walkthrough не выполнен |
| Production | NOT APPLIED | adoption boundary сохранена | snapshot, backup, SMTP, monitoring, deploy и traffic не одобрены |

Подробная трассировка: [EVIDENCE_MATRIX.md](./EVIDENCE_MATRIX.md).

## 6. Remaining gates

1. Зафиксировать этот pilot evidence package отдельным integrator commit и
   повторить финальные gates на exact commit.
2. Закрыть additive read contracts для decisions/selections, package-scoped
   sources и recipient-bound distribution acknowledgement.
3. Закрыть обязательный HTTP command surface: accepted v0.1 выполняет лишь
   часть human mutations; source/approval/baseline/release/distribution/handover
   нельзя считать E2E, пока unavailable-ветки не реализованы и не проверены.
4. Расширить direct handler tests: early `POST` paths уже покрывают CSRF,
   content type, malformed JSON, fixture guard и redaction; остаются
   unauthenticated/unexpected-backend mappings и фактические `GET` handlers.
   Это оставшаяся P2-зона независимого security review; P0/P1 не осталось.
5. Пройти route integration на disposable Supabase с настоящим request-bound
   JWT и без caller-supplied actor/org/role/package.
6. Пройти authenticated browser matrix owner/architect/builder/client/guest,
   включая cross-tenant/package denial.
7. Проверить custom API schema exposure, SMTP/Auth, upload/Storage и worker
   allowlist в production-shaped disposable environment.
8. Только после этого сформировать отдельный production release candidate и
   пройти adoption checklist.

## 7. Data hygiene

Pilot fixture и evidence не содержат raw Kora manifest, production filenames,
абсолютных локальных путей, secrets, raw tokens или signed URLs. Каталоги
`fixtures/**`, `tests/**` и `docs/**` исключены из Vercel artifact через
`.vercelignore`. Commit `1c803b0` удалил legacy public manifest, raw data,
scripts и styles; оставшийся sanitized index только ведёт в authenticated
`/dashboard/projectceo`. Targeted scan `public/**` на absolute paths, Kora source
roots, DWG/archive names и manifest path fields чист. Финальный deployment
artifact всё равно требует отдельной проверки.
