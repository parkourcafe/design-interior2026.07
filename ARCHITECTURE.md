# Архитектура продукта — зафиксированное состояние

Снимок того, что реально построено на ветке. Документ можно отправлять на внешний анализ.
Дата фиксации: 2026-07-17. Продукт: **ARHIDOM** (бывш. «Свод»).

Источник истины по продуктовым правилам — `CLAUDE.md`. Этот файл описывает **как оно устроено в коде**.

---

## 1. Что это

Pre-sale контур для интерьерных дизайнеров: **Бриф → Паспорт/Риски → Цена → КП**. Клиент проходит поведенческий (JTBD) бриф → система детерминированно строит машиночитаемый «паспорт проекта» и карточки рисков → дизайнер на Review Board принимает/отклоняет риски → собирает и отправляет коммерческое предложение. Слой ДО дизайна: до чертежей, визуализаций, закупок.

Русскоязычный интерфейс, валюта — рубль. Все строки UI — в `lib/i18n/ru.ts`.

Две точки входа (один движок):
- **Вход А — дизайнер** (за логином): создаёт проект → отправляет клиенту ссылку `/i/[token]` → разбирает результат → собирает КП. Железное правило: клиент Входа А **никогда не видит других дизайнеров**.
- **Вход Б — клиент** (публично, без регистрации): сам заполняет бриф `/api/client/create` → получает read-only ссылку-заявку `/b/[token]`, которую рассылает выбранным дизайнерам. **Каталога/матчинга/сортировки по цене нет** (сознательно — не маркетплейс). Полный слой Входа Б (shareable-паспорт, «Передать в пул», подтверждение вилки) — это Фаза 4, ещё не построена (гейт закрыт по SMTP-верификации).

---

## 2. Стек и деплой

| Слой | Технология | Состояние |
|---|---|---|
| Фронт/бэк | Next.js (App Router, async APIs), TypeScript strict, Tailwind | ✅ |
| БД/Auth/Storage | Supabase (Postgres + RLS; Auth: Google OAuth, email+пароль, OTP; bucket `client-uploads`) | ✅ проект `design2026` |
| LLM продукта | За интерфейсом `lib/llm/provider.ts` (`completeJSON`). Провайдеры: YandexGPT (дефолт), GigaChat (заглушка-throw), **z.ai/GLM** | ⚠️ прод-runtime `LLM_PROVIDER=zai`, модель `glm-4.6` |
| Хостинг | Vercel (Production = ветка `main`) | ✅ домен `arhidom.space` |
| Тесты | Vitest — **55 unit-тестов**, зелёные | ✅ |
| Магазины | TWA-готовность: manifest, иконки, assetlinks (Google Play + RuStore) | 🟡 каркас есть, публикация — ручная |

> ⚠️ **z.ai/GLM** — осознанное отступление от изначального guardrail «не китайские API» (решение владельца, задокументировано в `CLAUDE.md` и `.env.example`). Митигация 152-ФЗ: `lib/risks/llm.ts` вырезает город/район/контакты и маскирует телефон/email/@-ник в свободном тексте ДО вызова LLM. Смена на YandexGPT — только env, продуктовый код не трогается. `.env.example` по умолчанию ставит `yandex`; прод переключён на `zai` вручную.

---

## 3. Карта маршрутов

**Публичные (без логина):**
- `/` — лендинг ARHIDOM (кинематографичный, тёмный; `components/landing/*`).
- `/demo`, `/demo/brief`, `/demo/proposal` — демо-прогон без регистрации.
- `/designers`, `/studios`, `/security`, `/pilot` — маркетинговые/инфо-страницы; `/pilot` + `/api/pilot` — заявка на пилот.
- `/legal/privacy`, `/legal/terms` — юрблок.
- `/i/[token]` — бриф-визард (клиент проходит по ссылке; общий для Входа А и Б).
- `/b/[token]` — read-only «ссылка-бриф» (заявка клиента для рассылки дизайнерам).
- `/p/[public_token]` — публичное КП + печать (`@media print`) + CTA ответа клиента.
- `/login`, `/auth/callback` — вход (Google / почта+пароль / код на почту). `next`-редирект санитизируется до внутреннего пути.

**Кабинет дизайнера (защита в `app/dashboard/layout.tsx` — `getStudio()` → нет сессии → redirect `/login`):**

> ⚠️ Edge-middleware **отключён**: файл переименован `middleware.ts → proxy.ts` (экспорт `proxy`, не `middleware`), поэтому Next.js его не запускает и никто его не импортирует. Защита `/dashboard` держится только на серверной проверке в layout (`getStudio()`) — она отрабатывает на каждый рендер и безопасна, но проверки на edge нет. Чтобы вернуть edge-слой, файл нужно назвать `middleware.ts` с экспортом `middleware`.

- `/dashboard` — список проектов студии + создание.
- `/dashboard/projects/[id]` — Review Board (паспорт, карточки рисков, свои вопросы). **Профильный гейт:** ссылка на бриф показывается только при `isProfileComplete()` (имя/студия + телефон + email), иначе — блок «Заполнить профиль».
- `/dashboard/projects/[id]/proposal` — сборка/редактирование/отправка КП.
- `/dashboard/analytics` — воронка событий.
- `/dashboard/setup` — профиль студии, pricing, шаблон КП, **пароль**, **Команда**.

**API (server route handlers):**
- `/api/health` — статус подсистем (env, LLM-провайдер).
- `/api/auth/register` — регистрация без письма: `admin.createUser({email_confirm:true})` + rate-limit, затем клиентский `signInWithPassword`.
- `/api/auth/set-password` — смена пароля через `admin.updateUserById` (обходит проверку «слабый/утёкший пароль»); только с валидной сессией.
- `/api/client/create` — создать клиентский бриф (Вход Б, без дизайнера).
- `/api/intake/start | submit | upload` — служебные для брифа (сверка `intake_token` на сервере, service role).
- `/api/proposal/respond` — ответ клиента на публичном КП.
- `/api/pilot` — заявка на пилот.
- `/api/assetlinks`, `/app/manifest.ts`, `/app/icons/[size]`, `apple-icon` — PWA/TWA инфраструктура.

---

## 4. Три Supabase-клиента (важно для безопасности)

- `lib/supabase/server.ts` — **anon + cookies**, соблюдает RLS. Для server-компонентов кабинета (видно только своё).
- `lib/supabase/browser.ts` — **anon**, браузерный (`createBrowserClient`). Для клиентских компонентов и auth.
- `lib/supabase/admin.ts` — **service-role, ТОЛЬКО СЕРВЕР**, обходит RLS. Используется в публичных token-gated роутах (после сверки токена), в регистрации/пароле и в резолвере студии/команды. Anon-ключ доступа к чужим данным не даёт.

---

## 5. Аутентификация и команда

- **Методы входа (`app/login/page.tsx`):** Google OAuth · почта+пароль (`signUp`/`signInWithPassword` через `/api/auth/register`) · код на почту (OTP). `redirectTo` строится от `window.location.origin` (фикс «отбрасывает на главную»). `/auth/callback` обрабатывает и `?code` (PKCE), и `?token_hash&type` (stateless OTP).
- **Без зависимости от доставки писем:** регистрация и смена пароля работают через service-role без подтверждающих писем — SMTP не блокирует вход. (Выделенный SMTP для кодов верификации контактов Фазы 4 — отдельная незакрытая задача.)
- **Команда (`lib/studio.ts`, миграции `0006_team.sql` + `0007_invite_tokens.sql`):** студия = строка `designers` владельца; проекты принадлежат `studioId` (владельцу), поэтому видны всей команде. **Приглашение — по одноразовой ссылке-токену** `/join/<token>` (`app/join/[token]`, действие `acceptInvite`): владелец создаёт приглашение → получает ссылку → отправляет коллеге → тот входит и присоединяется. Токен гаснет после входа и истекает через 7 дней. `getStudio()` активирует членство **только** по этой ссылке — НЕ по совпадению email (закрыт дефект «захват студии», §16.3 a/b). Роли пока плоские (равный доступ). RLS переписана с «владелец» на «студия» через `is_studio_member(owner, uid)` (SECURITY DEFINER). **Обратная совместимость:** без миграции 0006 всё деградирует в режим единственного владельца; миграция 0007 обязательна для работы приглашений (fail-closed).

---

## 6. Пользовательские потоки

**Дизайнер:** войти → (заполнить профиль — гейт) → создать проект → скопировать `/i/[token]` → клиент проходит → Review Board: принять/отклонить риски → «Собрать КП» → редактировать секции → «Отправить» → `/p/[public_token]`.

**Клиент (Вход Б):** лендинг/`Я клиент` → `POST /api/client/create` → бриф `/i/[token]` → завершение → экран с кнопкой «Отправить ссылку» (`navigator.share`) → рассылает `/b/[token]`.

**Пайплайн после брифа** (`lib/brief/pipeline.ts`): `buildPassport(answers)` → слой правил (`lib/risks/rules.ts`) → LLM-проход (`lib/risks/llm.ts`, PII вырезан) → дедуп (`lib/risks/dedupe.ts`) → сохранение паспорта и карточек. **Обязательная деградация:** LLM недоступен/мусор → один repair-retry → фолбэк на rule-карточки, UX не падает.

---

## 7. Модель данных

Таблицы (миграции `0001`–`0006`): `designers`, `projects`, `answers`, `risk_cards`, `proposals`, `events`, `custom_questions` (0003), `rate_limits` (0005), `studio_members` (0006). Профиль дизайнера (0004) — jsonb `designers.profile`. `projects.designer_id` **nullable** (Вход Б без дизайнера).

**RLS:** дизайнер/студия видит только свои проекты (через `is_studio_member`); публичный доступ — только через server route по токену (service-role). `rate_limits`/`studio_members` — доступ только service-role/участникам студии.

**Rate limiting (`lib/rate-limit.ts`, `rate_limits`):** durable-счётчик по ключу `action:ip` в окне; **fail-open** (сбой БД не блокирует пользователя). Применён: register (10/ч), client/create (10/ч), intake/submit (30/ч), proposal/respond (20/ч), pilot (10/ч). In-memory на Vercel не годится (разные инстансы) — поэтому таблица.

**Shadow-паспорт (`projects.passport`, jsonb)** — детерминированно `buildPassport`:
`object{type,area_m2,city,district,floor,building,condition,replanning,neighbors_renovation}` · `vision` · `asset_horizon` · `household{now,in_5y,kids,pets,decision_makers}` · `lifestyle{morning_load,bathrooms,cooking,storage_pressure,furniture_keep,requirements[]}` · `budget{range|undisclosed,risk_level,includes_furniture}` · `timeline{target,urgency,hard_deadline}` · `style{refs[],anti[],notes,directions[],palette}` · `rooms{...}` · `pain_points` · `scope.package`.

> Известный долг: `scope.package` в `buildPassport` всегда `null` (пакет не спрашивается в брифе; в цене подставляется `"full"`). `str()` в `passport.ts` читает и `"x"`, и `{value:"x"}` — фикс инверсии смысла (напр. cooking → «не готовит»), закрыт регрессионным тестом.

Файлы клиента — в Storage (`client-uploads`, приватный); метаданные в `answers` (`question_id='attachments'`).

---

## 8. Логика (детерминированная, покрыта тестами)

- **`buildPassport(answers)`** (`lib/brief/passport.ts`) — маппинг ответов в паспорт. Без сети.
- **Правила рисков** (`lib/risks/rules.ts`, `confidence=high`, `source=rule`): премиум-материалы при низком бюджете · продажа/аренда+кастомизация · срочность+мебель на заказ · минимализм+высокое хранение · высокая утренняя нагрузка+1 санузел · перепланировка+срочность · мебель в тесном бюджете · много зон при малой площади · присоединение балкона (technical).
- **LLM-слой** (`lib/risks/llm.ts`): один вызов, строгий JSON по Zod-схеме (`schema.ts`), один repair-retry, PII вырезан/маскирован, тон «Возможный риск… Рекомендуем обсудить…».
- **Дедуп** (`lib/risks/dedupe.ts`): rule-карточки авторитетнее LLM; Unicode-aware сравнение словоформ.
- **Цена** (`lib/pricing/calc.ts`): диапазон = base × area × (сложность × срочность × пакет), прозрачная разбивка. `pricing=null` → режим «без цены». Сложность сейчас захардкожена `"mid"` (известный долг).
- **Proposal** (`lib/proposal/build.ts`): секции предзаполнены из паспорта + принятых карточек (`proposal_implication` → «что входит/не входит») + `proposal_defaults`; каждая редактируема. Пересборка запрещена после `status='sent'`.

---

## 9. События (метрики валидации)

В `events`: `intake_link_created`, `brief_started`, `brief_completed`, `proposal_created`, `proposal_sent`. Визуализация — `/dashboard/analytics`. События Фазы 4 (share/verify/pool/range) — ещё не пишутся (фаза не стартовала).

---

## 10. Лестница запуска (см. `CLAUDE.md` → «Лестница запуска»)

Три стадии готовности продукта (не путать с маркетплейс-механикой Входа Б):
- **Пилот** (5–10 бюро, приватно): P1 паспорт не инвертирует ✅ · P2 клиент видит бренд, не email ✅ · P3 consent+support+факт-чек PII ✅ · P4 обещание лендинга выровнено ✅ · P5 клиентский CTA ведёт в бриф ⏳ (ошибка сделана видимой; нужен ручной клик на живом сайте).
- **Расширение** (после WTP-интервью): S1 ценовое поведение КП · S2 верификация rule-движка на эталонах · S3 завершение сделки в публичном КП (accept/decline) · S4 петля обратной связи.
- **Публичный запуск:** L1 полный юрблок · L2 позиционирование догоняет продукт · L3 демо/онбординг.

---

## 11. Известные ограничения и долги

- **Фаза 4 (Вход Б полный)** — не построена; гейт закрыт: нет выделенного SMTP для 6-значных кодов верификации (S-B5 — первый кирпич).
- **`scope.package`** всегда `null` в паспорте; **сложность цены** захардкожена `"mid"`.
- **Мобильная вёрстка** брифа/паспорта — не выверена под узкие экраны.
- **Голосовой ввод** в брифе — Chrome/Android; на iOS нет.
- **`/b/[token]`** доступен по ссылке всем — повторное редактирование прикрыто статусом лишь частично.
- **`EventType`**-юнион синхронизирован с пишущимися событиями (вкл. `proposal_viewed/accepted/discussion_requested/changes_requested`) — сверять при добавлении новых.
- **`components/reveal.tsx`** — кандидат в мёртвый код (проверить использование перед удалением).
- **GigaChat** — заглушка-throw (по стратегии — задокументированный запасной, не активен).
- **Миграции 0005/0006** должны быть применены владельцем в Supabase (проект `design2026`); код fail-safe без них.

---

## 12. Файловая карта (ключевое)

```
app/            App Router: landing (page.tsx), login, auth/callback,
                i/[token], b/[token], p/[public_token], demo/*, dashboard/*,
                api/* (health, auth/*, client/create, intake/*, proposal/respond,
                pilot, assetlinks), manifest.ts, icons/[size], legal/*,
                designers/studios/security/pilot (маркетинг)
lib/brief/      questions.ts · passport.ts · pipeline.ts
lib/risks/      rules.ts · llm.ts · schema.ts · dedupe.ts
lib/pricing/    calc.ts
lib/proposal/   build.ts · respond.ts
lib/llm/        provider.ts · yandex.ts · gigachat.ts · zai.ts
lib/supabase/   server.ts (RLS) · browser.ts · admin.ts (service-role)
lib/            types.ts · i18n/ru.ts · designer.ts · studio.ts · intake.ts
                · tokens.ts · env.ts · base-url.ts · rate-limit.ts · review.ts
components/     landing/* (кинематографичный лендинг) · passport-view ·
                intake-link · designer-card · share-brief · print-button · pwa
supabase/migrations/  0001_init · 0002_client_briefs · 0003_custom_questions ·
                0004_designer_profile · 0005_rate_limits · 0006_team ·
                0007_invite_tokens
```

Доп. документы: `CLAUDE.md` (спека, источник истины), `LAUNCH_CHECKLIST.md`, `BACKLOG.md`,
`PHASE_0..3_REPORT.md`, `HANDOFF*.md`, `STORE_SETUP.md` / `RUSTORE_RELEASE.md` (магазины), `DEMO.md`.
