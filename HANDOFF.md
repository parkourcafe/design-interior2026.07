# HANDOFF — проект «Свод» (для продолжения в новой сессии)

## Что это за продукт
«Свод» — MVP pre-sale инструмента для интерьерных дизайнеров: **Бриф → Цена → КП (коммерческое предложение)**.
Клиент проходит поведенческий (JTBD) бриф по ссылке без регистрации → система строит машиночитаемый «паспорт» проекта + карточки рисков → дизайнер на Review Board принимает/отклоняет риски и собирает КП.
Два равноправных входа: **дизайнер** (кабинет за логином) и **клиент** (публичный бриф). Есть и самостоятельный бриф клиента → шаринг-ссылка `/b/[token]` (это НЕ маркетплейс).
Язык интерфейса — русский, валюта — рубль.

## Владелец / стиль общения
Основатель — нетехническая, предпочитает **короткие ответы и голосовой ввод**. Объяснять простыми словами, по шагам. Все внешние настройки (Supabase/Resend/DNS) вести пошагово.

## Стек
- Next.js 14 App Router, TypeScript strict, Tailwind CSS, Vitest (54 теста).
- Supabase: Postgres + RLS + Auth (magic link + 6-значный код) + Storage (`client-uploads`).
- LLM за интерфейсом `lib/llm/provider.ts` → `completeJSON(prompt, schema)` (Zod safeParse + один repair-retry + деградация к rule-карточкам).
  **Провайдер продукта — z.ai / Zhipu GLM (`glm-4.6`)** — это осознанное ОТСТУПЛЕНИЕ от guardrail CLAUDE.md («без китайских API»), одобрено владельцем. env: `LLM_PROVIDER=zai`, `ZAI_API_KEY`, `ZAI_BASE_URL=https://api.z.ai/api/paas/v4`.
- Деплой: Vercel (Production branch = `main`).

## Репозиторий и правила git
- Репозиторий: **`parkourcafe/design-interior2026.07`** (работать ТОЛЬКО с ним).
- Ветка разработки: **`claude/new-session-gsayp3`**. Разработка → PR через GitHub MCP → merge → `git reset --hard origin/main`.
- Коммиты подписывать `Co-Authored-By: Claude ...`. Модель-идентификатор НЕ писать в коммитах/PR/артефактах — только в чате.
- PR создавать только по явной просьбе.

## Supabase (актуально)
- Реальный проект приложения: **`design2026`**, ветка `main (PRODUCTION)`, тариф PRO, орг `saidanigmatullaeva@gmail.com's Org`.
- **Все миграции применены и подтверждены** (проверено SELECT-ом): колонки `projects.custom_questions`, `designers.profile`, `projects.designer_id` (nullable) на месте. Миграции 0001–0004 в `supabase/migrations/`.

## Ограничения среды разработки (важно)
- Песочница **блокирует весь исходящий HTTP** (curl/WebFetch/внешние CDN → 403). Поэтому: нельзя увидеть отрендеренный прод-сайт, нельзя скачать внешние медиа (CloudFront), Google Fonts при локальном тесте не грузятся.
- Локально тестировать можно так: `npm run build` + `npm start` + Playwright-core через `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`, отсекая внешние хосты в `page.route`. (playwright-core ставить временно и удалять из package.json перед коммитом.)

## Что уже сделано (последняя большая волна)
Аудит сайта — все пункты закрыты и запушены:
1. Файлы клиента (план/фото) и голосовые комментарии к вопросам теперь **видны дизайнеру** на странице проекта (подписанные ссылки из Storage).
2. Бюджетный уровень считается по **середине** вилки (был верх → «съедал» budget-риск).
3. Пустой экран брифа при восстановлении черновика — защищён (clamp шага).
4. В self-serve брифе скрыт вопрос «откуда узнали о дизайнере».
5. Публичное КП `/p/[token]` отдаётся только при `status='sent'` (черновик клиент не видит); в редакторе ссылка показывается только после «Отправить».
6. **Очистка персданных для LLM**: `lib/risks/llm.ts` рекурсивно маскирует email/телефон/@-ник/длинные номера в свободном тексте (видение, боли, заметки, комментарии); refs (ссылки) не трогает. Есть тест.
7. Кнопка **«Пересобрать»** КП (`rebuildProposal` в `.../proposal/actions.ts`) — заново собирает секции из паспорта/цены/принятых рисков; после «Отправить» запрещена.
8. **Мобильные тап-таргеты**: «Войти» в шапке, лого (слоган скрыт до sm), контакты в карточке дизайнера → ≥44px. Проверено в Chromium 375px: горизонтального скролла нет, JS-ошибок нет.
9. **Логин облегчён 157→92 КБ**: Supabase-клиент грузится лениво (`await import`) при отправке формы (`app/login/page.tsx`).
10. **Медиа лендинга оптимизированы**: 3 картинки → `next/image` (fill+sizes, webp/avif, lazy, фикс сдвигов); `remotePatterns` для CDN в `next.config.mjs`; `preconnect` в `app/layout.tsx`. Базовый URL медиа вынесен в `NEXT_PUBLIC_MEDIA_BASE` (по умолчанию CDN). Скрипт `npm run fetch:media` (`scripts/fetch-landing-media.mjs`) качает медиа в `public/landing` для самостоятельного хостинга — запускать ЛОКАЛЬНО (в песочнице CDN заблокирован).

Метрики (прод, локально, свой код): FCP < 120 мс, вес страниц 92–176 КБ, overflow 0, pageErrors 0.

## Что осталось (на завтра, операционка на стороне владельца)
1. **Часть А — код в письме.** В Supabase → Authentication → Emails → Templates → шаблоны **Magic Link** и **Confirm signup** вставить HTML с `{{ .Token }}` (6-значный код) и `{{ .ConfirmationURL }}` (ссылка). Готовый HTML — в переписке. 2 минуты. Логин уже умеет вход по коду (`verifyOtp({email, token, type:'email'})`).
2. **Часть Б — SMTP (Resend).** Встроенная почта Supabase лимитирована. Настроить кастомный SMTP: Resend → верифицировать домен (DNS SPF/DKIM) → API key → в Supabase Project Settings → Authentication → SMTP Settings: host `smtp.resend.com`, port `465`, user `resend`, password = ключ `re_…`, sender `noreply@домен`.
   **ОТКРЫТЫЙ ВОПРОС к владельцу: есть ли свой домен для почты?** Если нет — SMTP отложить (для демо хватает встроенной), домен+Resend позже.

## Ключевые файлы
- Бриф (источник истины вопросов): `lib/brief/questions.ts` (поле `tier: 'quick'`); паспорт: `lib/brief/passport.ts` (`buildPassport`, покрыт тестами).
- Риски: `lib/risks/rules.ts` (9 правил), `lib/risks/llm.ts` (LLM + PII-очистка), дедуп в пайплайне.
- Цена: `lib/pricing/calc.ts`; КП: `lib/proposal/build.ts`.
- Мастер брифа (клиент): `app/i/[token]/wizard.tsx` (двухшаговый, автосохранение, голос через Web Speech API).
- Кабинет: `app/dashboard/...`; проект: `app/dashboard/projects/[id]/page.tsx`; КП: `.../proposal/{page,editor,actions}.tsx`.
- Публичное КП: `app/p/[public_token]/page.tsx`; шаринг брифа: `app/b/[token]/page.tsx`.
- Лендинг: `app/page.tsx`; layout: `app/layout.tsx`; логин: `app/login/page.tsx`.
- i18n: `lib/i18n/ru.ts`. Бренд: Cormorant Garamond (заголовки) + Golos Text; палитра терракота `#9c4a28` + слива/клиент `#7a3a5a`.

## Definition of Done каждой фазы
`npm run build`, `lint`, `typecheck`, `test` — зелёные; ключевая логика покрыта unit-тестами; секреты только в env.
