# ArchiDom RU — Master Execution Plan после Charter v0.4

Дата первоначального плана: 17 июля 2026 года.
Обновлено и принято: 18 июля 2026 года.
Статус: активный delivery-план до authenticated pilot.
Продуктовый источник истины:
[`ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md`](../ArchiDom_Russia_Product_Charter_v0.4_2026-07-18.md).

```text
PUBLIC_PRODUCT=ArchiDom
DELIVERY_REGION=RU_ONLY
PROJECTCEO_INTERNAL_NAMESPACE=compatibility_only
LOCAL_PILOT_EVIDENCE=487e993
SANITIZED_BROWSER_QA=pass
AUTHENTICATED_BROWSER_QA=pending
PRODUCTION_READY=false
PRODUCTION_APPLIED=false
```

## 1. Решение и текущая цель

ArchiDom — один продукт, один аккаунт, одна Organization, один Project и одна
Память проекта. Четыре публичных модуля являются ролевыми рабочими пространствами:

```text
M1 · Заказчик
  → Contracted Project Passport
M2 · Дизайнер
  → Approved Design Intent + Approved Selections
M3 · Архитектор
  → Released Production Package
M4 · ГлавПрораб
  → As-built & Warranty Archive
```

Текущая инженерная цель — не строить все целевые функции Charter одновременно, а
довести уже принятый Project Intelligence Core до настоящего authenticated RU pilot
на disposable Supabase. После него та же модель должна принять минимум один внешний
пакет реального покупателя. Production остаётся отдельным решением.

## 2. Что уже принято

### 2.1 Архитектура и persistence

- модульный монолит и слои domain/application/ports/adapters/delivery;
- Organization/Project enrollment, membership и package scope;
- Invitation/AccessGrant contracts;
- source registry, provenance, exact revisions и human review;
- Decisions, Selections, ApprovalPackages и price observations;
- immutable ProjectBaseline и ProductionPackageVersion;
- distribution, acknowledgement, ChangeRequest и bounded impact;
- photo evidence, milestone acceptance и immutable handover archive;
- append-only audit и human/worker executor separation.

### 2.2 Request-bound application

- cookie-bound human JWT через request-scoped Supabase client;
- server-derived actor/organization/project/package/role;
- strict command schemas, same-origin/JSON gate и stable idempotency;
- controlled portfolio/project reads и DTO sanitization;
- fail-closed multi-org, sibling-package и downstream error handling;
- отсутствие service-role/private-table path для human operations;
- локальный read-only Kora route для пяти sanitised role projections.

### 2.3 Accepted evidence

| Слой | Commit | Статус |
|---|---|---|
| Persisted M2/M3 | `9874524` | PG16/PG17, RLS, concurrency, rollback/replay PASS |
| Thin M4 | `e74f4b3` | release/impact/closure DB5 PASS |
| Public manifest retirement | `1c803b0` | real filenames/paths удалены из public assets |
| Request-bound UI | `a8c86a8` | local integration/security review accepted |
| Kora pilot evidence | `487e993` | deterministic full-project E2E + sanitized browser PASS |
| Readiness verdict | `88b1442` | local ready / authenticated and production pending |

Последний release gate на принятом дереве: lint без ошибок, typecheck PASS,
56 test files / 328 tests PASS, Next build PASS, dependency audit 0 vulnerabilities.
DB5 прошёл PostgreSQL 16/17, RLS/ACL, concurrency, idempotency, rollback и restart
replay. Эти результаты являются локальным evidence, а не production approval.

## 3. Compatibility mapping v0.4

Существующий код не выбрасывается и не переименовывается механически.

| Charter v0.4 | Существующий контур | Решение |
|---|---|---|
| ArchiDom | ProjectCEO UI/copy | Новый публичный copy; internal namespaces временно сохраняются |
| M1 · Заказчик | legacy brief/passport/proposal | Стабилизировать и передавать immutable Contracted Project Passport |
| M2 · Дизайнер | Decisions/Selections/Approvals | Это принятый Project Brain foundation; Design Workspace наращивается отдельными gates |
| M3 · Архитектор | sources/baseline/package/release | Продолжить через exact revisions и immutable release |
| M4 · ГлавПрораб | distribution/change/photo/handover | Тонкий контур принят; WBS/estimate/procurement расширять после wedge validation |
| Память проекта | Project Intelligence Core | Каноническое ядро без fork |

`projectceo_*` database schemas/RPC и внутренние TypeScript paths являются
compatibility contracts. Их rename не создаёт пользовательской ценности и может
сломать migration ledger, поэтому требует отдельного ADR, additive bridge и rollback.

## 4. Текущие незакрытые ворота

### AP1 — Disposable authenticated environment

- отдельный Supabase project/environment, не production;
- exact additive migration ledger;
- custom API schemas exposed, private schemas не exposed;
- request-bound Auth/PostgREST, Storage и schema cache;
- безопасные env secrets, redirect allowlist и test-only mail delivery;
- пять отдельных пользователей: owner, designer/architect, builder, client, guest.

### AP2 — Read contracts

Закрыть additive projections/RPC для:

- decisions и selections;
- package-scoped sources и review state;
- approval/baseline/release status;
- recipient-bound distribution и acknowledgement;
- impact/photo/milestone/handover state;
- organization selector либо явный one-pilot-organization limit.

Read DTO не раскрывает private relation names, original filenames, absolute paths,
signed URLs, sibling packages или другую Organization.

### AP3 — Command surface

Довести request-bound HTTP/application contract до обязательного Kora flow:

1. create/accept/revoke invitation и grant lifecycle;
2. register/review source;
3. create/review Decision и Selection exact revision;
4. publish ProjectBaseline;
5. publish/distribute ProductionPackageVersion;
6. acknowledge exact release;
7. create ChangeRequest и review calculated impacts;
8. submit/review photo evidence;
9. accept milestone;
10. build/close handover через отдельный worker allowlist там, где это требуется.

Каждая команда получает identity/scope server-side, использует stable idempotency и
возвращает controlled error. UI не показывает synthetic success.

### AP4 — Direct route and security evidence

- direct `GET`/`POST` handler tests для auth success/failure, CSRF, content type,
  malformed JSON, downstream errors, status/cache/error redaction;
- cross-organization, cross-project и sibling-package negative tests;
- revoke/expire/replay/concurrency tests;
- service-role отсутствует в browser bundle и human route;
- worker RPC имеет отдельный client и fixed allowlist;
- Storage upload/download использует opaque keys и URL TTL не более 15 минут.

### AP5 — Authenticated Kora browser E2E

Одна Organization без ручной записи в private tables проходит:

```text
owner enrollment
→ invitation and role acceptance
→ sanitized Kora source registration
→ exact source review
→ Decision/Selection approval
→ ProjectBaseline V1
→ ProductionPackageVersion V1
→ scoped distribution and acknowledgement
→ one real change with RUB/day delta
→ bounded impact and human dispositions
→ ProjectBaseline/Package V2
→ photo evidence and milestone acceptance
→ handover closure
```

Browser matrix выполняется отдельной authenticated session для каждой роли. Переключение
role через query, fixture или client state не считается evidence.

### AP6 — External package gate

До заморозки широкого M2–M4 необходимо провести через те же contracts минимум один
внешний пакет реального покупателя:

- package не подгоняется под Kora fixture;
- фиксируются import gaps и неизвестные типы источников;
- подтверждается package/room/discipline mapping;
- измеряется время до baseline, число конфликтов и downstream use;
- Kora counts не используются как универсальная форма всех проектов.

### AP7 — Commercial validation

Charter v0.4 требует сравнить три wedge:

1. платный аудит дизайн-пакета на комплектность/конфликты;
2. платный M1→M2 цикл для дизайнера;
3. платное управление одним объектом в M4.

Широкий build получает сценарий с наиболее быстрым подтверждённым платежом и повторным
использованием. Минимальный gate: два оплаченных concierge/pilot-сценария, один второй
проект той же компании и измеримый downstream result. Уже заявленные предоплаты должны
получить письменные scope/success criteria, но не подменяют техническую приёмку.

## 5. Параллельные workstreams после AP1 freeze

### Stream A — Data/Auth/API

Владеет additive migrations, custom API exposure, read RPC, command persistence,
invitation/grant lifecycle, Storage authorization, executor separation и PG harness.

Не меняет product copy или browser role semantics самостоятельно.

### Stream B — ArchiDom workspaces/UI

Владеет публичным ArchiDom naming, role navigation, M1–M4 handoff surfaces, loading/
empty/error/stale states и mobile/accessibility.

Не реконструирует authorization в TypeScript, не передаёт caller-supplied scope и не
использует admin/service client.

### Stream C — QA/Security/Pilot evidence

Владеет authenticated role matrix, direct handler tests, negative tenancy/package
tests, Kora/external runbooks, metrics и immutable evidence ledger.

Не меняет contracts для удобства теста; gaps возвращает владельцу соответствующего слоя.

### Интегратор

Владеет frozen interfaces, sequencing, shared-file ownership, cross-module acceptance,
security review, release checks и финальным GO/NO-GO. At most one stream меняет shared
contract; существующие timestamped migrations никто не переписывает.

## 6. M1–M4 scope после authenticated pilot

### M1 · Заказчик

Ближайший P0: защищённый brief, итоговая версия, комментарий, принятие КП, upload/status
внешнего договора и immutable Contracted Project Passport. Собственная юридически
значимая ЭП не строится без provider/legal gate.

### M2 · Дизайнер

Принятый foundation: decisions, selections, approvals, price observations и provenance.
Следующий продуктовый P0 после выбора wedge: одна комната, три управляемых варианта,
Approved Design Intent/Selections и budget frame.

AI-actions, два provider adapters, credits и cost ledger требуют отдельного benchmark,
privacy/legal review и unit-economics spec. До него допустим concierge fallback; нельзя
обещать unlimited AI или автоматическое утверждение.

### M3 · Архитектор

Ближайший P0: PDF/JPG/PNG/CSV/XLSX intake, room/sheet/specification links, revision,
completeness/conflict review, baseline и immutable Released Production Package. Native
CAD/BIM authoring не строится.

### M4 · ГлавПрораб

Принятый тонкий P0: distribution/acknowledgement, ChangeRequest, impact review, photo,
milestone и handover. WBS, schedule, split estimate, procurement и Change Order являются
следующим платным расширением только после M4 wedge validation. ERP/warehouse/accounting
не входят.

## 7. Definition of Done для authenticated pilot

### Product

- пользователь проходит обязательный flow без ручной записи в Supabase;
- публичный UI использует ArchiDom и четыре понятных workspace names;
- Kora остаётся одним Project около 1 800 м²;
- внешний пакет проходит через ту же модель;
- каждое изменение связано с причиной, exact revisions, impact и новой выдачей.

### Data and security

- actor/organization/project/package/role выводятся server-side;
- RLS/ACL deny-by-default и negative tenancy зелёные;
- guest grants hashed/expiring/scoped/revocable;
- source/evidence/version/handoff lineage воспроизводима;
- published artifacts immutable, audit append-only;
- logs/artifacts не содержат PII, original filenames, raw tokens или signed URLs;
- human JWT и worker executor разделены.

### Engineering

```text
npm run lint       PASS
npm run typecheck  PASS
npm run test       PASS
npm run build      PASS
PG16/PG17          PASS
RLS/concurrency/idempotency/rollback/restart replay PASS
authenticated browser matrix PASS
```

### Commercial

- минимум два paid pilot scope с критериями успеха;
- минимум один внешний пакет;
- минимум два downstream package uses;
- минимум один second-project start;
- измеряются time-to-passport, time-to-baseline, conflict yield, change cycle,
  avoided rework и AI cost per approved result там, где AI реально используется.

## 8. Production boundary

Authenticated disposable pilot не разрешает production adoption. До production нужны:

- свежий read-only schema/grants/policies/ledger snapshot;
- database и Storage backup/restore rehearsal;
- production-equivalent clone и exact migration/history repair review;
- Russian data-plane/152-ФЗ legal and technical decision;
- Auth/SMTP/redirect/rate-limit configuration;
- monitoring, alerts, incident owner, kill switch и rollback commander;
- deployment artifact scan;
- заполненный adoption checklist и отдельный человеческий GO.

Baseline SQL нельзя выполнять на существующей production. US/multi-region runtime,
data movement и production deploy не входят в этот план.

## 9. Следующее исполнимое действие

Собрать AP1 specification по фактическому Supabase test environment, затем параллельно
закрыть AP2 read contracts, AP3 command surface и AP4 direct route/security tests.
После их интеграции пройти AP5 Kora с пятью настоящими sessions и только затем AP6
внешний пакет. Ребрендинг публичного copy выполняется внутри Stream B, не через rename
database schemas или migration history.
