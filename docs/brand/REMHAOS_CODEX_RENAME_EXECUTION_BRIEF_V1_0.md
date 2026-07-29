# REMHAOS — Codex Brand Rename Execution Brief v1.0

**Дата:** 28 июля 2026  
**Тип:** repository audit + controlled rename + deployment verification  
**Статус:** EXECUTION-READY  
**Новый публичный бренд:** `RemhaOS`  
**Новый основной домен:** `remhaos.com`

---

## 0. Команда Codex

Выполни контролируемое переименование публичного продукта `RemhaOS / RemhaOS Space` в `RemhaOS` и миграцию primary host на `https://remhaos.com`.

Это **не новая архитектура**, не redesign и не разрешение расширять функциональный scope. Не создавай новые модули, не переписывай M1–M4, не меняй доменную модель и не добавляй функции под видом rebrand.

Сначала восстанови фактический rename surface репозитория, затем внеси минимальные production-grade изменения, выполни тесты, browser QA и подготовь доказательный отчёт.

Не останавливайся после аудита. После inventory переходи к реализации.

---

## 1. Нормативные источники

Приоритет:

1. `REMHAOS_BRAND_DECISION_ADDENDUM_A3_V1_0.md` — брендовый Product Contract Addendum.
2. Product Charter v0.5 Canonical и последующие утверждённые аддендумы.
3. Фактический production code и migrations.
4. Реальное production behavior.
5. Platform Architecture v1.1.
6. Execution Brief Sprint 1.
7. Остальные документы.

Adendum A3 меняет только бренд и домен. При конфликте по архитектуре действует Charter/Architecture; при конфликте по публичному имени действует A3.

---

## 2. Phase 0 — repository and deployment inventory

До изменения кода установи:

- repository root;
- default branch;
- production branch;
- production commit;
- Vercel/deployment project;
- текущие production domains;
- DNS ownership assumptions, которые можно доказать;
- Supabase project и auth URL settings;
- email provider и sender domains;
- analytics/Search Console integrations;
- app/PWA/store manifests;
- public/private/token routes;
- locations of generated documents and templates.

Выполни residual inventory минимум по шаблонам:

```bash
rg -n -i --hidden \
  --glob '!node_modules/**' \
  --glob '!.git/**' \
  --glob '!dist/**' \
  --glob '!build/**' \
  --glob '!coverage/**' \
  'archidom|archi[ -]?dom|arhidom|arhidom\.space|www\.arhidom\.space'
```

Проверь отдельно:

- filenames и directories;
- code strings;
- environment examples;
- migrations;
- tests/snapshots;
- fixtures;
- emails;
- templates;
- metadata;
- JSON-LD;
- public assets;
- generated exports;
- docs;
- CI/CD;
- Vercel/Supabase config;
- OAuth callbacks;
- CORS/CSP;
- redirects/rewrites;
- analytics events;
- external webhooks.

Создай до реализации:

- `docs/brand/REMHAOS_RENAME_INVENTORY_2026-07-28.md`;
- `docs/brand/REMHAOS_RENAME_MAP_2026-07-28.csv`;
- `docs/brand/REMHAOS_DOMAIN_CUTOVER_CHECKLIST_2026-07-28.md`;
- `docs/brand/REMHAOS_RENAME_RISK_REGISTER_2026-07-28.csv`.

Для каждого совпадения классифицируй:

- `PUBLIC_REPLACE`;
- `ACTIVE_DOC_RENAME`;
- `TECHNICAL_ALIAS`;
- `LEGACY_REDIRECT`;
- `HISTORICAL_KEEP`;
- `MIGRATION_KEEP`;
- `EXTERNAL_CONFIG`;
- `UNKNOWN`.

Ничего не заменяй внутри migrations, audit history или archived evidence без доказанной необходимости.

---

## 3. Канонический naming contract

Используй:

```text
Official brand: RemhaOS
Russian pronunciation: РемХаос
Technical prefix: REMHAOS
Primary host: https://remhaos.com
```

Запрещено создавать новые варианты:

```text
RemHaus
Remhaos
Rem Haos
РемХаус
Ремхаос
```

В обычном тексте бренд всегда `RemhaOS`. `REMHAOS` допустим только в технических префиксах и диаграммах.

---

## 4. Реализуемый scope

### 4.1. Public UI and content

Заменить пользовательские вхождения старого бренда в:

- layout;
- navigation;
- header/footer;
- homepage;
- audience pages;
- pilot/demo;
- login/auth;
- dashboard;
- client portal;
- email copy;
- proposal/contract copy;
- exported documents;
- support messages;
- error states;
- onboarding;
- empty states;
- public API responses, если они показываются пользователю.

Не переписывать тексты функционально. Только заменить бренд и доменные ссылки, кроме явно найденных устаревших обещаний, которые уже запрещены текущим truth contract.

### 4.2. Metadata and structured data

Обновить:

- `metadataBase`;
- titles/descriptions;
- canonical;
- Open Graph;
- Twitter card;
- Organization;
- WebSite;
- SoftwareApplication;
- manifest name/short_name;
- app icons/wordmarks, если новые assets присутствуют;
- sitemap;
- robots;
- `llms.txt`;
- RSS/feeds, если существуют;
- emails and exported document URLs.

Не добавлять непроверенные `sameAs`, цены, рейтинги, юридические реквизиты или новый слоган.

### 4.3. Domain cutover

Настроить `remhaos.com` как primary host.

Требования:

- primary host возвращает 200;
- alternate new host возвращает 301 в один переход;
- каждый контролируемый legacy host возвращает 301 в один переход на эквивалентный path;
- path и допустимые query сохраняются;
- Vercel preview URL не попадает в canonical/schema/sitemap;
- production build отклоняет preview URL как `SITE_URL`;
- redirect chains отсутствуют;
- redirect loops отсутствуют;
- private/token routes не индексируются;
- старые public token links продолжают работать через совместимый host mapping.

Не редиректить все старые paths на homepage.

### 4.4. Auth and integrations

Обновить и проверить:

- Supabase Site URL;
- Supabase allowed redirect URLs;
- password reset;
- magic links;
- invite links;
- OAuth callbacks;
- CORS allowlist;
- CSP;
- cookies/domain flags;
- webhook callbacks;
- public storage URLs;
- form submission origins;
- analytics domain allowlists;
- support/email sender links.

Внешние панели, которые Codex не может изменить, перечислить как `OWNER_ACTION_REQUIRED` с точными значениями для вставки.

### 4.5. Active documents

Создать брендовые successor-файлы с префиксом `REMHAOS_`.

Не удалять и не переписывать исторические документы. Для старых active docs:

1. создать successor;
2. в старом файле добавить superseded banner, если файл изменяем и не является историческим evidence;
3. иначе переместить/скопировать в `docs/archive/archidom/`;
4. обновить внутренние ссылки на successor.

Обязательные successor-файлы определить по фактическому репозиторию. Минимально ожидать Charter, Architecture, Execution Brief, Entity Catalog, Workflow Catalog, Decision Log и текущие matrices/reports.

### 4.6. Technical identifiers

Нейтральные identifiers не менять:

- `project_*`;
- `workflow_*`;
- `approval_*`;
- `validation_*`;
- `technical_conflicts`;
- `evidence_items`;
- domain entity names.

Брендовые constants/env vars:

- добавить новый канон `REMHAOS_*`;
- сохранить `ARCHIDOM_*` как deprecated alias только при фактической необходимости совместимости;
- задокументировать срок удаления alias;
- не логировать secrets.

Не менять историю migrations. Если таблица/column содержит старый бренд, сначала оцени impact и используй migration с backward compatibility, а не редактирование старого SQL.

---

## 5. Обязательные тесты

### 5.1. Static residual scan

После реализации residual scan должен вернуть только допустимые категории:

- archive;
- immutable migrations;
- redirect compatibility;
- superseded banners;
- historical audit/commit references;
- explicit deprecated aliases.

Каждое оставшееся совпадение перечислить в отчёте с причиной.

### 5.2. Domain and redirect tests

Проверить:

- apex new host;
- www new host;
- каждый old host;
- homepage;
- audience pages;
- pilot/demo;
- login;
- auth callback;
- private routes;
- public token routes;
- sitemap;
- robots;
- `llms.txt`;
- OG image;
- 404;
- trailing slash behavior;
- query preservation.

### 5.3. Product regression

Обязательно:

- существующие проекты открываются;
- brief links работают;
- passport работает;
- risks работают;
- pricing остаётся deterministic;
- proposal generation работает;
- proposal issue approval сохраняется;
- public proposal tokens работают;
- auth/RLS не ослаблены;
- no data loss;
- no Module 5;
- no new product claims.

### 5.4. Build gates

Запустить фактические repository commands для:

- unit tests;
- integration tests;
- regression tests;
- typecheck;
- lint;
- production build;
- desktop browser QA;
- mobile browser QA.

Не придумывать команды. Сначала прочитать `package.json`, CI и project docs.

---

## 6. SEO and analytics cutover

Подготовить owner checklist для внешних систем:

- Google Search Console domain property;
- Change of Address, если применимо и доступно;
- sitemap submit;
- Bing Webmaster Tools;
- Yandex Webmaster;
- GA/analytics property/domain settings;
- Yandex Metrica allowed domains;
- tag manager;
- email provider domain verification;
- SPF/DKIM/DMARC;
- social profile links;
- store/app listing links, если существуют.

Не заявлять, что внешнее действие выполнено, если Codex не имеет доступа. Пометить `OWNER_ACTION_REQUIRED`.

---

## 7. Architecture lock

Переименование не разрешает:

- менять четыре модуля;
- создавать Module 5;
- переписывать Project Graph;
- менять Project Memory;
- менять Validation Engine из A2;
- добавлять Timeline planner;
- добавлять marketplace;
- добавлять contractor ratings;
- добавлять escrow/arbitration;
- расширять M2–M4;
- проводить redesign без отдельного brief;
- добавлять новый слоган как утверждённый факт;
- переписывать юридическое лицо.

В диаграммах разрешена только брендовая замена:

```text
ARCHIDOM EXPERIENCE LAYER → REMHAOS EXPERIENCE LAYER
ARCHIDOM PLATFORM CORE → REMHAOS PLATFORM CORE
```

Всё остальное остаётся без изменения.

---

## 8. Deliverables

Создать:

- `docs/brand/REMHAOS_RENAME_INVENTORY_2026-07-28.md`;
- `docs/brand/REMHAOS_RENAME_MAP_2026-07-28.csv`;
- `docs/brand/REMHAOS_DOMAIN_CUTOVER_CHECKLIST_2026-07-28.md`;
- `docs/brand/REMHAOS_RENAME_RISK_REGISTER_2026-07-28.csv`;
- `docs/brand/REMHAOS_RENAME_IMPLEMENTATION_REPORT_2026-07-28.md`;
- active successor documents with `REMHAOS_` prefix;
- redirect tests;
- residual scan output;
- exact owner action checklist for external consoles.

Implementation Report must contain:

- `EXTRACTED` repository facts;
- `IMPLEMENTED` changes;
- `INTERPRETED` decisions;
- `BLOCKED` items;
- exact files changed;
- exact environment/config changes;
- redirect map;
- migrations;
- tests and results;
- browser evidence;
- residual old-name matches;
- unresolved risks;
- rollback procedure;
- production commit SHA;
- deployment URL;
- final statuses.

---

## 9. Acceptance criteria

Task is complete only if:

```text
PUBLIC_BRAND: REMHAOS_ONLY
PRIMARY_HOST: REMHAOS_COM
LEGACY_REDIRECTS: PASS
AUTH_CALLBACKS: PASS
PUBLIC_TOKEN_COMPATIBILITY: PASS
SEO_CANONICALS: PASS
RESIDUAL_SCAN: CLEAN_WITH_EXPLICIT_EXCEPTIONS
PRODUCT_REGRESSION: PASS
ARCHITECTURE_CHANGED: NO
DATA_LOSS: NO
OWNER_ACTIONS: DOCUMENTED
```

Если production domain, DNS, external consoles или email verification не доказаны, не ставь PASS. Поставь `OWNER_ACTION_REQUIRED` или `BLOCKED` с точной инструкцией.
