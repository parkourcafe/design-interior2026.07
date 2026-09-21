# HANDOFF — RemHaOS (для продолжения в новой сессии)

## Что это за продукт
RemHaOS — единый интерьерный проект с четырьмя ролевыми рабочими пространствами:

1. **M1 · Заказчик** — Contracted Project Passport.
2. **M2 · Дизайнер** — Approved Design Intent + Approved Selections.
3. **M3 · Архитектор** — Released Production Package.
4. **M4 · ГлавПрораб** — As-built & Warranty Archive.

Пространства используют общие Organization, Project и package contracts;
это не четыре независимых приложения. Сценарий **Бриф → Цена → КП** —
существующая pre-sale поверхность M1, а не граница всего продукта.
В ней клиент проходит бриф по ссылке, а дизайнер проверяет риски и готовит КП.
Самостоятельный бриф `/b/[token]` также относится к этой поверхности.
Язык интерфейса — русский, валюта — рубль.

Актуальные основания: `docs/canonical/remhaos-v1/REMHAOS_CHARTER_v0.5_CANONICAL.md`,
`docs/canonical/remhaos-v1/REMHAOS_DECISION_LOG_v1.md` и утверждённое владельцем
MASTER ТЗ текущего запуска. Состояние конкретных пакетов проверять по их
текущим commit/PR и evidence; merge и локальные проверки не доказывают production.

## Владелец / стиль общения
Основатель — нетехническая, предпочитает **короткие ответы и голосовой ввод**. Объяснять простыми словами, по шагам. Все внешние настройки (Supabase/Resend/DNS) вести пошагово.

## Стек
- Next.js App Router, TypeScript strict, Tailwind CSS, Vitest; точные версии —
  в `package.json` и `package-lock.json` текущего checkout.
- Supabase: Postgres + RLS + Auth (magic link + 6-значный код) + Storage (`client-uploads`).
- LLM за интерфейсом `lib/llm/provider.ts` → `completeJSON(prompt, schema)` (Zod safeParse + один repair-retry + деградация к rule-карточкам).
  Допустимый провайдер определяется действующим контрактом и журналом решений;
  этот handoff не разрешает смену провайдера или платные вызовы.
- Деплой: Vercel; production branch — `release`. Изменять её или делать
  production deploy может только владелец в отдельном контролируемом gate.

## Репозиторий и правила git
- Репозиторий: **`parkourcafe/design-interior2026.07`** (работать ТОЛЬКО с ним).
- Default branch и база PR: **`main`**. Разработка ведётся в изолированной
  рабочей ветке и попадает в `main` только через проверяемый PR.
- Не использовать `git reset --hard`, не добавлять model-identifiers в коммиты,
  PR или артефакты.

## Supabase (актуально)
- Production-проект приложения: **`ztnycrchwxqczqbyegnp`**, организация
  **Remhaos+ Pet ID**. Его legacy-линия миграций не совпадает с репозиторным
  clean bootstrap; применение миграций возможно только отдельным adoption gate.

## Исторические ограничения прошлой среды (перепроверить перед применением)
- Песочница **блокирует весь исходящий HTTP** (curl/WebFetch/внешние CDN → 403). Поэтому: нельзя увидеть отрендеренный прод-сайт, нельзя скачать внешние медиа (CloudFront), Google Fonts при локальном тесте не грузятся.
- Локально тестировать можно так: `npm run build` + `npm start` + Playwright-core через `/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell`, отсекая внешние хосты в `page.route`. (playwright-core ставить временно и удалять из package.json перед коммитом.)

## Исторический отчёт о pre-sale поверхности
Ниже сохранён отчёт прежней сессии. Это не текущая приёмка M1–M4 и не
подтверждение состояния production; результаты сверять с актуальным кодом и CI:
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

Исторически были заявлены FCP < 120 мс, вес страниц 92–176 КБ, overflow 0,
pageErrors 0. Текущий checkout и production этими числами не подтверждены.

## Почта и внешние настройки
Текущую готовность шаблонов проверять по `supabase/email-templates/README.md`:
сохранённые HTML содержат прежний бренд и пока не готовы к установке в production.
Изменения production Auth/SMTP, DNS, credentials и платных ресурсов требуют
отдельного owner gate непосредственно перед действием.

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
