# CLAUDE.md — AI-квалификация клиента и сборка КП для интерьерных дизайнеров (MVP v0.1)

## Что мы строим

Walking skeleton pre-sale продукта: дизайнер отправляет клиенту ссылку → клиент проходит quick brief (~10 вопросов с ветвлением) → система строит паспорт проекта и карточки рисков → дизайнер на Review Board принимает/отклоняет риски → собирает и отправляет коммерческое предложение.

Это слой ДО дизайна: до чертежей, до визуализаций, до закупок. Цель v0.1 — рабочее демо для платного пилота и WTP-интервью, не production-масштаб.

## Кто пользователь

Платит и настраивает — дизайнер. Рынок русскоязычный: интерфейс на русском, валюта — рубль. Клиент дизайнера проходит бриф по публичной ссылке без регистрации.

## Стек (зафиксирован — не менять и не обсуждать)

- Next.js 14+ App Router, TypeScript strict
- Supabase: Postgres + Auth (magic link по email) + Storage (план/фото)
- LLM продукта: YandexGPT (Yandex Cloud Foundation Models) — основной провайдер; GigaChat (Сбер) — задокументированный запасной. Провайдер и модель из env: `LLM_PROVIDER` (yandex|gigachat), `LLM_MODEL`, `YC_FOLDER_ID`, `YC_API_KEY`. Вызовы ТОЛЬКО из server route handlers через `lib/llm/provider.ts`. Никаких Anthropic / OpenAI / китайских API в runtime продукта
- Tailwind CSS; без тяжёлых UI-библиотек
- Vitest для unit-тестов логики
- Деплой: Vercel

## Архитектурные правила

1. Ключи только в env. `.env.example` обязателен, секреты никогда не коммитятся.
2. Любой ответ LLM — строгий JSON по схеме (схема дублируется в тексте промпта). Парсинг через Zod `safeParse`; при провале — один repair-retry («верни только валидный JSON по схеме»), затем фолбэк: UX не падает, показываем rule-карточки.
3. RLS включён: дизайнер видит только свои проекты. Публичный intake работает через server route по `intake_token` (сверка токена на сервере, service role); anon-ключ доступа к чужим данным не даёт.
4. Все строки интерфейса — в `lib/i18n/ru.ts`. Это подготовка будущей EN-локализации, саму EN НЕ делаем.
5. Деньги — integer в рублях, диапазоны как [min, max].
6. LLM-провайдер спрятан за интерфейсом `lib/llm/provider.ts` с единственным методом `completeJSON(prompt, schema)`: смена YandexGPT → GigaChat → западный провайдер при EN-экспансии не трогает продуктовый код. Актуальные имена моделей и эндпоинты сверяются с официальной документацией провайдера в фазе 0 — не по памяти.

## Модель данных

```sql
designers: id uuid (= auth.users.id), name, studio_name,
  pricing jsonb null,           -- null = режим «без цены»
  proposal_defaults jsonb       -- exclusions, лимит правок, условия этапов

projects: id, designer_id, client_name,
  status ('created'|'brief_sent'|'brief_in_progress'|'brief_completed'|'proposal_draft'|'proposal_sent'),
  intake_token text unique, passport jsonb, created_at

answers: id, project_id, question_id text, value jsonb, created_at

risk_cards: id, project_id,
  risk_type ('budget'|'timeline'|'function'|'style'|'technical'),
  evidence text[], impact text, confidence ('low'|'medium'|'high'),
  designer_action text, proposal_implication text,
  status ('proposed'|'accepted'|'rejected'), source ('rule'|'llm')

proposals: id, project_id, version int, sections jsonb,
  status ('draft'|'sent'), public_token text, sent_at

events: id, designer_id, project_id, type text, created_at
```

Файлы клиента — в Supabase Storage; метаданные пишутся в answers (`question_id = 'attachments'`).

### Shadow-паспорт (`projects.passport`)

```
object: { type: 'flat'|'house'|'apartments', area_m2: number, city: string }
asset_horizon: 'self_long' | 'sell_2_5y' | 'rent' | 'unknown'
household: { now: string, in_5y: string, kids: boolean, pets: boolean }
lifestyle: { morning_load: 'low'|'mid'|'high', bathrooms: number,
             cooking: 'none'|'basic'|'heavy', storage_pressure: 'low'|'mid'|'high' }
budget: { range: [number, number] | 'undisclosed', risk_level: 'low'|'mid'|'high' }
timeline: { target: string, urgency: 'normal'|'urgent' }
style: { refs: string[], anti: string[], notes: string }
pain_points: string
scope: { package: 'concept'|'full'|'full_plus_supervision'|null }
```

Паспорт заполняется детерминированно функцией `buildPassport(answers)` — обязательно покрыть unit-тестами.

## Quick brief: 10 вопросов

Источник истины — `lib/brief/questions.ts`. Каждый вопрос несёт: `id`, текст, тип (choice/multi/number/text/files), `passport_field`, `show_if` (ветвление).

1. `object` — тип объекта, площадь м², город → object.*
2. `asset_horizon` — «Что будет с этим жильём через 3–5 лет?» (для себя надолго / возможно продам / сдам в аренду / пока не знаю) → asset_horizon
3. `household` — кто живёт сейчас; кто может добавиться за 5 лет: дети, родители, животные → household.*
4. `morning` — «Как выглядит будний утренний час?» — сколько человек собираются одновременно + сколько санузлов сейчас → lifestyle.morning_load, lifestyle.bathrooms
5. `cooking` — готовите ли и как часто; ветка `show_if != 'none'`: на скольких человек → lifestyle.cooking
6. `storage` — «Что сейчас не помещается?» (одежда / спорт / техника / книги / всё помещается) → lifestyle.storage_pressure
7. `budget` — бюджетный коридор на ремонт и комплектацию: диапазоны + «не готов назвать» → budget.range
8. `timeline` — когда хотите закончить; флаг срочности → timeline.*
9. `style` — 3–5 референсов (ссылки или загрузка) + что точно НЕ нравится → style.*
10. `pain` — «Что больше всего раздражает в текущем жилье?» — свободный текст → pain_points

Опциональный шаг «загрузить план/фото» — только хранение, БЕЗ анализа изображений.

Продуктовое правило тона: вопросы поведенческие, не прямые. Не «нужна ли вам ванна» — а «как проходит утро». Никаких вопросов про доход: только поведенческие прокси.

## Выявление противоречий: гибрид

**Слой 1 — детерминированные правила** (`lib/risks/rules.ts`, тестируются, `confidence='high'`, `source='rule'`):
- budget низкий/средний + премиальные материалы в style.notes/refs → budget
- asset_horizon = sell/rent + запросы глубокой кастомизации → budget/scope
- timeline.urgency = urgent + индивидуальная мебель в пожеланиях → timeline
- storage_pressure = high + «минимализм» в стиле → function
- morning_load = high + bathrooms = 1 → function

**Слой 2 — LLM-проход**: один серверный вызов с passport + сырыми ответами; промпт требует строго JSON-массив карточек по схеме risk_card; confidence ставит модель. Дедупликация с карточками слоя 1.

**Тон карточек — продуктовое правило:** «Возможный риск: … Evidence: … Рекомендуем обсудить: …». Никогда «клиент противоречит себе». AI предлагает — дизайнер утверждает или отклоняет.

## Цена (v0.1 — просто)

`designers.pricing = { base_rate_per_m2, multipliers: { complexity: {low, mid, high}, urgency, package: {...} } }`.

Диапазон = base × area × (произведение выбранных множителей, min..max). Расчёт детерминированный, разбивка показывается дизайнеру («почему цена такая»). Если `pricing = null` — режим «без цены»: КП собирается без блока стоимости.

НИКАКОГО pricing-мастера с реверс-инжинирингом из прошлых проектов — это v0.2.

## Proposal

Секции: задача клиента (авто из брифа) · состав работ · этапы и сроки · стоимость (если есть) · что входит / что не входит · лимиты правок · что нужно от клиента · условия завершения этапов.

Каждая секция — редактируемый текст, предзаполненный из паспорта, принятых risk-карточек (`proposal_implication` → «что входит/не входит») и `proposal_defaults`. Публичная страница `/p/[public_token]` + версия для печати через `@media print` — это и есть «PDF» v0.1. Кнопка «Отправить» → `status='sent'`, событие `proposal_sent`.

## События (метрики валидации из стратегии)

Писать в `events`: `intake_link_created`, `brief_started`, `brief_completed`, `proposal_created`, `proposal_sent`. Отдельный дашборд не нужен — достаточно данных в таблице.

## Что НЕ строить в v0.1 (guardrails — абсолютные)

Биллинг и тарифы · мультивалютность и EN-локализация · ML-pricing и pricing-мастер · генерация изображений/концепций · анализ загруженных планов · спецификации · deep brief (только quick) · PDF-библиотеки (печатная HTML-страница) · marketplace и любые рекомендации/матчинг дизайнеров · внешние интеграции · Anthropic / OpenAI / китайские LLM API в runtime продукта (ограничение не касается инструментов разработки — Claude Code разрешён).

Любая идея из этого списка или вне scope — строка в `BACKLOG.md`, не код.

## Definition of Done для каждой фазы

`npm run build`, `lint`, `typecheck`, `test` — зелёные · ключевая логика фазы покрыта unit-тестами (`buildPassport`, rules, pricing, ветвление) · написан `PHASE_N_REPORT.md`: что сделано / как проверить руками за 5 минут / известные ограничения / вопросы · секреты не в коде.

## Команды

`npm run dev` · `npm run build` · `npm run lint` · `npm run typecheck` · `npm run test`
