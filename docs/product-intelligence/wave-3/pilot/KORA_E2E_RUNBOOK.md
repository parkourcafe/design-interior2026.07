# ProjectCEO RU — Kora End-to-End Pilot Runbook

Дата: 18 июля 2026 года.
Цель: повторить один sanitized full-project flow без production writes.

## 1. Fast deterministic gate

```bash
zsh tests/projectceo-e2e/run-local.zsh
```

Ожидаемый terminal marker:

```text
KORA_PILOT_LOCAL_OK production_changed=false
```

Проверить в JSON:

- `areaM2=1800`, `model=full_project`;
- `209 / 81 / 128` sources;
- 5 packages / 4 work packages;
- два approved baseline packages;
- immutable V1, exact V2 release;
- exact distribution/acknowledgement;
- `+180000 RUB`, `+2 days`, 3 impacts, 3 human dispositions;
- approved no-change terminal;
- incomplete handover rejected, full handover ready;
- все isolation booleans `true`;
- `productionChanged=false`.

## 2. Disposable database gate

Требуется локальный Docker. Скрипт не подключается к Supabase production.

```bash
zsh tests/projectceo-e2e/run-db.zsh
```

Ожидаемые terminal markers:

```text
DB5_EXECUTION_HARNESS_OK image=postgres:16-alpine
DB5_EXECUTION_HARNESS_OK image=postgres:17-alpine
KORA_PILOT_DB_OK pg16=true pg17=true production_changed=false
```

Fresh run 18 июля 2026 года достиг всех markers на PG16 и PG17 с exit code `0`.
Premature Package V2 release отклонён, а release после CR/impact/human review
принят.

Harness включает Foundation, M2/M3 и M4 migrations, forced RLS/ACL, positive и
negative tenancy/package paths,
concurrency, rollback и restart replay.

## 3. Request-bound integration gate

Разрешённый server contract:

- reads через `createProjectCeoServerPort()`;
- `getPortfolio({requestId})`;
- `getProjectWorkspace({projectId,requestId})`;
- caller не передаёт role, organization, package, actor или effective scope;
- human command использует request-bound JWT, не service role;
- worker имеет отдельный fixed allowlist.

Explicit disposable fixture mode:

```text
PROJECTCEO_LOCAL_FIXTURE_MODE=1
PROJECTCEO_LOCAL_FIXTURE_ROLE=<owner|architect|builder|client|guest>
```

Он обязан fail-closed в production. `PROJECTCEO_DEMO_ROLE` не может участвовать
в production authorization.

Планируемые HTTP surfaces должны быть сверены с фактическим кодом перед QA:

```text
GET  /api/projectceo/portfolio
GET  /api/projectceo/projects/[projectId]
POST /api/projectceo/commands
```

Этот gate считается PASS только после integration tests на фактически принятом
server adapter. Документ сам по себе не является evidence.

Accepted request-bound layer `a8c86a8` fail-closed оставляет unavailable:

```text
create_invitation
acknowledge_release
register_source
review_source
review_selection
publish_baseline
publish_release
distribute_release
build_handover
```

Доступные orchestration branches ограничены revoke invitation/grant,
ChangeRequest, impact review, photo evidence/review и milestone acceptance.
Accepted UI v0.1 вызывает только revoke guest grant и ChangeRequest;
acknowledgement остаётся disabled/read-contract-pending. Поэтому даже зелёные
static/unit integration tests не закрывают полный Kora HTTP flow.

### 3.1 Выполненный sanitized browser check

18 июля, примерно `11:14–11:27 UTC`, пять `/projectceo-qa/[role]` routes прошли
manual DOM/tab/viewport/console check на Next `16.2.10` dev server. Owner прошёл
8 tabs; guest видел только exact package Overview/Releases; owner+guest mobile
`390×844` не имели horizontal page overflow; console errors/warnings отсутствовали.
Screenshots/trace не сохранялись. Это `SANITIZED_BROWSER_QA=pass`, не
authenticated PostgREST/RLS evidence.

## 4. Authenticated browser matrix

Для каждой роли использовать отдельную реальную authenticated session; не
переключать роль через query/client state.

### Owner

- видит full project, 5 packages и access administration;
- регистрирует sanitized source;
- публикует baseline/release;
- распределяет exact architecture release;
- создаёт/проверяет ChangeRequest и handover state.

### Architect

- видит sources/decisions/baseline/release/change;
- создаёт Selection revision и human disposition;
- не управляет owner-only membership.

### Builder

- получает только разрешённый scope;
- подтверждает exact release hash;
- добавляет photo evidence;
- не публикует release.

### Client

- review-ит selection и milestone в разрешённом scope;
- подтверждает exact release;
- не распределяет release и не видит owner access admin.

### Guest

- видит только Overview и exact granted architecture release;
- sibling engineering package возвращает controlled denial;
- revoked/expired grant возвращает controlled denial;
- sources, members и audit не перечисляются.

### Обязательные negatives

- cross-organization project selector;
- cross-project package selector;
- package revision вне baseline;
- stale expected state;
- same idempotency key / different digest;
- password-only invitation acceptance;
- revoked/expired guest grant;
- human command через worker/service client;
- service worker пытается выполнить human review.

## 5. Final release gate

На одном exact commit:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
zsh tests/projectceo-e2e/run-local.zsh
zsh tests/projectceo-e2e/run-db.zsh
```

После этого интегратор добавляет фактические browser evidence: commit, UTC,
roles, routes, screenshots/trace location и negative results. Пока этих данных
нет, `AUTHENTICATED_BROWSER_QA=pending`.

## 6. Stop conditions

- actor/org/role/package принимаются из client body как authority;
- human RPC выполняется через service role;
- guest перечисляет sibling package/project/member/source/audit;
- original filename, absolute path, raw token или signed URL попадает в DTO/log;
- M4 или UI тесты выполнены не на том же commit, что release candidate;
- production endpoint, database или Storage затронуты без отдельного adoption.
