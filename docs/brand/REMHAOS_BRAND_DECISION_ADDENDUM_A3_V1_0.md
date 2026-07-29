# Аддендум A3 к Product Charter v0.5 — фиксация бренда RemHaOS

**Дата:** 28 июля 2026  
**Класс документа:** Product Contract Addendum  
**Статус:** УТВЕРЖДЕНО ВЛАДЕЛЬЦЕМ  
**Владелец решения:** Селена  
**Предмет:** замена публичного бренда RemHaOS / RemHaOS Space на RemHaOS без изменения продуктовой и технической архитектуры.

---

## 0. Короткое решение

**[РЕШЕНО]** С 28 июля 2026 года публичный бренд продукта:

- **официальное написание:** `RemHaOS`;
- **произношение на русском:** «РемХаос»;
- **основной домен:** `remhaos.com`;
- **старый публичный бренд:** `RemHaOS` / `RemHaOS Space` — прекращает использоваться в актуальном интерфейсе, маркетинге, новых документах и публичных материалах.

**[ПОДТВЕРЖДЕНО ВЛАДЕЛЬЦЕМ]** Домен `remhaos.com` приобретён.

Не использовать как официальное написание:

- `RemHaus`;
- `RemHaOS`;
- `REMHAOS` в обычном тексте;
- `Rem Haos`;
- `РемХаус`;
- смешение кириллицы и латиницы внутри одного технического имени.

Допустимо:

- `REMHAOS` в технических префиксах файлов, констант и диаграмм;
- «РемХаос» в русском пояснительном тексте;
- `RemHaOS` во всех брендовых поверхностях.

---

## 1. Что это решение меняет

Меняется только брендовый и доменный контракт:

1. название продукта;
2. публичный домен;
3. брендовые строки в интерфейсе;
4. названия актуальных документов;
5. SEO, metadata, schema и ссылки;
6. шаблоны писем, документов и экспортов;
7. auth, callback, CORS, CSP и интеграционные URL, зависящие от домена;
8. имена активных брендовых файлов и префиксов.

---

## 2. Что это решение не меняет

**[РЕШЕНО]** Переименование не меняет:

- Product Charter v0.5 по существу, кроме публичного имени;
- четыре доменных модуля M1–M4;
- первый рынок и первого плательщика;
- Project Workspace;
- Project Graph;
- Project Memory;
- Studio Memory;
- Decision Ledger;
- EvidenceItem;
- Project Check;
- Validation Engine и правила Аддендума A2;
- роли Заказчик, Дизайнер, Архитектор, ГлавПрораб;
- workflow M1;
- текущий sprint scope;
- запрет на Module 5;
- запрет на marketplace, escrow, арбитраж и каталог подрядчиков;
- модель данных, если техническое имя не содержит старого бренда;
- исторические факты и audit trail.

Новая архитектура не создаётся. Новый модуль не создаётся. Никакая функция не считается готовой только из-за нового названия.

---

## 3. Обновлённая продуктовая формулировка

**RemHaOS — единая система проектных решений, которая сохраняет память интерьерного проекта, проверяет готовность к каждому следующему этапу и управляет последствиями изменений.**

Коммерческая формула остаётся прежней:

> **Не переходите к следующему дорогому этапу вслепую.**

RemHaOS показывает:

- что подтверждено;
- чего не хватает;
- где есть противоречия;
- кто должен принять решение;
- что решение изменит в бюджете, сроках, документации и исполнении;
- что должно произойти следующим.

Слоган «Ремонт без хаоса» этим аддендумом **не фиксируется**. Его можно тестировать в маркетинге отдельно, не превращая рабочую фразу в новый продуктовый контракт.

---

## 4. Канонический словарь замены

| Старое значение | Новое значение | Правило |
|---|---|---|
| RemHaOS | RemHaOS | Публичный бренд |
| RemHaOS Space | RemHaOS | Не использовать `Space` в основном бренде |
| ARCHIDOM | REMHAOS | Технический префикс активных документов и диаграмм |
| ARHIDOM | REMHAOS | Старое доменное/SEO-написание заменяется |
| arhidom.space | remhaos.com | Новый основной host после cutover |
| www.arhidom.space | remhaos.com | 301, если старый host контролируется |
| ARCHIDOM EXPERIENCE LAYER | REMHAOS EXPERIENCE LAYER | Только подпись слоя |
| ARCHIDOM PLATFORM CORE | REMHAOS PLATFORM CORE | Только подпись слоя |
| ARCHIDOM PLATFORM FOUNDATION | REMHAOS PLATFORM FOUNDATION | Имя текущего execution-трека |

`Project`, `Project Graph`, `Project Memory`, `Studio Memory`, `Validation Engine`, `TechnicalConflict`, названия таблиц и доменных сущностей не переименовываются, потому что являются нейтральными техническими терминами.

---

## 5. Правило для действующих и исторических документов

### 5.1. Актуальные документы

Активные канонические документы получают successor-файлы с префиксом `REMHAOS_` и обновлёнными публичными строками.

Минимальный набор:

- `REMHAOS_CHARTER_v0.5_CANONICAL.md`;
- `REMHAOS_PLATFORM_ARCHITECTURE_v1.1.md`;
- `REMHAOS_EXECUTION_BRIEF_SPRINT_1.md`;
- `REMHAOS_ENTITY_CATALOG_v1.md`;
- `REMHAOS_WORKFLOW_CATALOG_v1.md`;
- `REMHAOS_DECISION_LOG_v1.md`;
- `REMHAOS_READINESS_MATRIX_v1.csv`;
- `REMHAOS_CANONICAL_PACKAGE_v1.1.docx`.

В каждом successor-файле указать:

> Brand-only successor of the corresponding ARCHIDOM document. Product scope and architecture are unchanged except where a later approved addendum explicitly says otherwise.

### 5.2. Исторические документы

Исторические документы **не переписываются задним числом**, потому что это разрушит provenance и audit trail.

Они перемещаются или логически маркируются как:

```text
docs/archive/archidom/
```

и получают заметный статус:

```text
SUPERSEDED_BY_BRAND_RENAME_2026-07-28
CURRENT_BRAND: RemHaOS
```

Старое название допустимо только:

- в архивных документах;
- в неизменяемой истории миграций и commit history;
- в redirect map;
- в журнале решений;
- в тестах совместимости, проверяющих legacy URLs.

Иными словами, «везде» означает **во всём актуальном продукте**, а не стирание истории. Удалять доказательства прошлого ради косметической чистоты было бы весьма человеческим, но архитектурно бессмысленным занятием.

---

## 6. Доменный и SEO-контракт

После cutover:

1. `https://remhaos.com` — единственный primary canonical host.
2. Вариант `www.remhaos.com` либо 301 на apex, либо становится primary по отдельному OWNER DECISION. Два primary host запрещены.
3. Все контролируемые старые host направляются 301 в один переход на эквивалентный путь нового домена.
4. Query parameters сохраняются, кроме явно мусорных tracking-параметров.
5. Canonical, Open Graph, Twitter, JSON-LD, sitemap, robots, `llms.txt`, email links и document links используют только новый host.
6. Старые URL не удаляются до проверки redirect coverage.
7. Sitemap старого домена после миграции содержит только redirectable URLs либо отключается после обработки Search Console.
8. Создаются и проверяются свойства нового домена в поисковых системах и аналитике.

Обязательная redirect-форма:

```text
https://legacy-host/<path>?<query>
→ 301
https://remhaos.com/<path>?<query>
```

Не направлять все старые URL на главную страницу. Это удобный способ уничтожить накопленные сигналы поиска, поэтому человечество практикует его с пугающей регулярностью.

---

## 7. Технический контракт переименования

### 7.1. Публичные строки меняются немедленно

Проверить и заменить:

- header, footer, navigation;
- title, H1, metadata и descriptions;
- onboarding;
- login, auth и transactional screens;
- emails;
- PDF/DOCX/XLSX exports;
- proposal и contract templates;
- manifest, PWA name, short name;
- app/store labels, если они существуют;
- favicon, wordmark, OG assets;
- JSON-LD `Organization`, `WebSite`, `SoftwareApplication`;
- support text и sender display names;
- публичные demo-данные;
- legal pages, где указан именно бренд, а не юридическое лицо;
- docs и README, относящиеся к актуальному продукту.

### 7.2. Доменозависимые настройки

Проверить:

- Vercel project domains;
- `SITE_URL`, `NEXT_PUBLIC_SITE_URL` и аналоги;
- Supabase Site URL и allowed redirect URLs;
- OAuth callback URLs;
- email magic links и password reset links;
- CORS/CSP allowlists;
- webhook callback URLs;
- storage/public asset URLs;
- cookie domain;
- service-worker scope;
- analytics allowed domains;
- payment or form callback URLs, если они существуют;
- email SPF, DKIM и DMARC для нового домена.

### 7.3. Что нельзя массово переименовывать вслепую

Не переименовывать без repository-grounded проверки:

- таблицы базы данных;
- существующие migrations;
- primary keys и foreign keys;
- audit event history;
- object storage keys;
- external IDs;
- secrets;
- analytics event history;
- OAuth client IDs;
- package names, используемые внешними consumers;
- repository slug;
- deployment project ID.

Если существует брендовый env var, применяется совместимый переход:

```text
REMHAOS_*  — новый канон
ARCHIDOM_* — deprecated alias на один release cycle
```

После доказанного cutover legacy alias удаляется отдельной миграцией.

---

## 8. Decision Log

Добавить решение:

| ID | Решение | Статус | Основание | Последствие |
|---|---|---|---|---|
| DEC-019 | Публичный бренд RemHaOS заменён на RemHaOS; основной домен `remhaos.com` | LOCKED | OWNER DECISION 28.07.2026 / Addendum A3 | Актуальные UI, docs, metadata и public URLs используют RemHaOS; архитектура не меняется |

Решение не переоткрывается без нового факта и отдельного OWNER DECISION.

---

## 9. Открытые гейты

Переименование не означает, что завершены:

- проверка и регистрация товарного знака `RemHaOS`;
- утверждение логотипа;
- утверждение слогана;
- юридическое обновление оферт и политики, если там используется старый бренд;
- миграция email sender domain;
- перенос Search Console и аналитики;
- decommission старого домена.

Покупка домена подтверждает контроль домена, но не является заключением о товарном знаке.

---

## 10. Acceptance criteria

Переименование считается завершённым только если:

- на всех публичных страницах отображается `RemHaOS`;
- публичный residual scan не находит `RemHaOS`, `ARCHIDOM`, `ARHIDOM` и `arhidom.space`, кроме утверждённых legacy/redirect контекстов;
- `remhaos.com` возвращает production 200;
- старые контролируемые host возвращают 301 в один переход на эквивалентный путь;
- canonical и schema указывают новый host;
- sitemap, robots и `llms.txt` используют новый host;
- auth и password reset не ломаются;
- proposal/public tokens продолжают работать либо имеют совместимые redirects;
- существующие проекты и данные не изменены;
- migrations не переписаны задним числом;
- typecheck, lint, tests и production build проходят;
- desktop/mobile browser QA проходит;
- Search Console/analytics checklist создан;
- активные документы имеют successor с `REMHAOS_`;
- старые документы архивированы или помечены как superseded;
- финальный отчёт содержит точный список файлов, URL, redirects, tests, unresolved risks и commit SHA.

---

## 11. Финальная формула

> **RemHaOS — новая публичная идентичность существующего продукта. Архитектура не меняется. Меняются имя, домен и все зависимые брендовые поверхности через один контролируемый rename pass.**
