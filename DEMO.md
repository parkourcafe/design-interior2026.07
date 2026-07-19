# DEMO — сквозной сценарий: от intake-ссылки до отправленного КП

Демо русскоязычного pre-sale контура: **Бриф → Цена → КП**.

## Подготовка (один раз)

1. `.env.local` заполнен реальными значениями (шаблон — `.env.example`):
   - Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   - Yandex Cloud: `YC_FOLDER_ID`, `YC_API_KEY` (`LLM_PROVIDER=yandex`, `LLM_MODEL=yandexgpt-lite`).
   - `NEXT_PUBLIC_APP_URL` (для локали — `http://localhost:3000`).
2. Применить миграцию `supabase/migrations/0001_init.sql` к проекту Supabase.
3. `npm run seed` — демо-дизайнер `demo@studio.ru` с готовыми `pricing` и `proposal_defaults`.
4. `npm run dev`.

## Сценарий

### 1. Вход дизайнера
- `/login` → email `demo@studio.ru` → magic link → `/dashboard`.

### 2. (Опц.) Настройка
- `/dashboard/setup` — проверить/поправить ставки в pricing-мастере или выключить «считать цену» (режим «без цены»). Настроить exclusions и лимит правок для КП.

### 3. Создание проекта и intake-ссылка
- На `/dashboard` — «Новый проект», имя клиента → создаётся проект, событие `intake_link_created`.
- На странице проекта — блок со ссылкой `/i/<token>`, кнопка «Скопировать».

### 4. Клиент проходит бриф (в приватном окне, без регистрации)
- Открыть `/i/<token>` → «Начать» (событие `brief_started`).
- Пройти ~10 вопросов: тип объекта/площадь/город, горизонт актива, домохозяйство, утро, готовка (+ветка «на скольких»), хранение, бюджет, сроки, стиль (референсы + анти), pain points. Опц. — загрузить план/фото.
- «Завершить» (событие `brief_completed`): строится паспорт, гоняется пайплайн rules + LLM, сохраняются карточки.

### 5. Дизайнер на Review Board
- Обновить `/dashboard/projects/<id>`: паспорт в читаемом виде, карточки рисков (6 полей, тон «Возможный риск…»), недостающие данные.
- **Принять** релевантные карточки, **отклонить** лишние. В «вопросах к первой встрече» появляются `designer_action` принятых карточек.
- Если LLM недоступен — виден баннер деградации, но работают rule-карточки.

### 6. Сборка КП
- «Собрать коммерческое предложение» → `/dashboard/projects/<id>/proposal` (событие `proposal_created`, статус `proposal_draft`).
- Секции предзаполнены из паспорта + принятых карточек + `proposal_defaults`. Блок «Стоимость» — диапазон с разбивкой (или отсутствует в режиме «без цены»).
- Отредактировать секции → «Сохранить».

### 7. Публикация и отправка
- Открыть публичную ссылку `/p/<public_token>` — клиентский вид КП; «Печать / PDF» (через `@media print`).
- «Отправить» → статус `proposal_sent`, событие `proposal_sent` (**activation-метрика**).

## Проверка событий (метрики)

В таблице `events` за сценарий появятся: `intake_link_created` → `brief_started` → `brief_completed` → `proposal_created` → `proposal_sent`.

## Быстрые проверки без БД

- `npm run test` — 43 unit-теста (паспорт, правила, ветвление, дедуп, парсер LLM, цена, КП, review).
- `npx tsx eval/run-eval.ts` → `eval/phase1_results.md` — 9 профилей бриф→карточки.
- `npm run build` · `npm run lint` · `npm run typecheck` — зелёные.
