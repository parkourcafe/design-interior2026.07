# SEO_IMPLEMENTATION_REPORT — технический SEO + money-страницы

**Дата:** 20.07.2026
**Основание:** документы 27 (тех. SEO код-беклог), 28 (OG-картинки + метаданные), 29 (эталонная money-страница `/designers`).
**Область:** инфраструктура индексации + авто-OG + новые контентные страницы под целевые запросы. Продуктовый код (бриф/паспорт/риски/цена/КП) не затронут.

---

## Что сделано

### 1. Техническая SEO-инфраструктура (документ 27)
- `lib/site.ts` — единый `SITE_URL` (env `NEXT_PUBLIC_SITE_URL` → фолбэк `NEXT_PUBLIC_APP_URL` → апекс `arhidom.space`).
- `app/robots.ts` — `robots.txt`: разрешает публичное, запрещает `/login /auth/ /dashboard/ /i/ /p/ /b/ /api/`, ссылается на sitemap.
- `app/sitemap.ts` — только публичные индексируемые URL. Токен-страницы, кабинет, API и `/compare/*` (ждёт фактчека) исключены намеренно.
- `app/layout.tsx` — добавлены `metadataBase`, `title.template = "%s — ARHIDOM"`, canonical `/`, OpenGraph/Twitter (без `images` — их даёт `opengraph-image.tsx`), `robots: index,follow` по умолчанию; в `<body>` подключён `<JsonLd/>`.
- `lib/seo.ts` — `pageMetadata()` (title/description/canonical/OG/Twitter одной строкой; путь A — без `images`).
- `components/json-ld.tsx` — Organization + WebSite + SoftwareApplication (без Offer/Rating — честно, тарифов и отзывов нет).
- `next.config.mjs` — `redirects()` (www → апекс, 301), `headers()` (`X-Robots-Tag: noindex` на `/dashboard /i /p /b /api /login` + базовые security-заголовки на всё), `outputFileTracingIncludes` для шрифтов OG.
- `noindex` на приватных сегментах: `metadata.robots` в `app/i/[token]`, `app/p/[public_token]`, `app/b/[token]`, `app/dashboard/layout.tsx`, новый `app/login/layout.tsx` (page — клиентский, поэтому layout).
- `.env.example` — добавлен `NEXT_PUBLIC_SITE_URL`.

### 2. OG-картинки next/og + метаданные (документ 28, путь A)
- `lib/og.tsx` — генератор картинки 1200×630 на теме `#14110d`. Кириллический шрифт **Golos Text SemiBold** (срезы cyrillic + latin, `app/_fonts/*.woff`) — читается лениво с диска, кешируется.
- `app/opengraph-image.tsx` — дефолтная картинка сайта.
- Персональные `opengraph-image.tsx` для money-страниц: `/designers`, `/studios`, `/demo/brief`, `/demo/proposal`, `/product/passport`, `/solutions/changes`, `/guides/*`, `/compare/*`, `/for-clients`.
- Метаданные (`pageMetadata`) проставлены/переведены на всех публичных страницах; заголовки больше не дублируют бренд (шаблон добавляет « — ARHIDOM» ровно один раз).

### 3. Контентные money-страницы (документ 29)
- `components/landing/seo-content-page.tsx` — общий data-driven рендерер в кинематографичной дизайн-системе лендинга (hero, prose, steps, features, сравнительная таблица, FAQ+FAQPage, финальный CTA + перелинковка). Весь копирайт — из `lib/i18n/ru.ts` (`ru.seo.*`, guardrail #4).
- Новые страницы (page.tsx + opengraph-image.tsx): `/product/passport`, `/solutions/changes`, `/guides/lost-approvals`, `/guides/client-changes`, `/guides/budget-overrun`, `/for-clients`, `/compare/teroom-vs-arhidom` (**noindex**, вне sitemap — до фактчека по конкуренту).
- `/designers` — к существующей кинематографичной странице добавлены видимый FAQ + `FaqJsonLd` + блок перелинковки «Смотрите также».
- `components/faq-json-ld.tsx` — переиспользуемая FAQPage-разметка (только для реально видимого FAQ).

Дисциплина честности выдержана: только функции M1 (бриф, паспорт, риски, цена-ориентир, КП, повестка), «ИИ готовит черновик — решает специалист», «бесплатно в пилоте» вместо выдуманных цен, без фейковых цифр/отзывов. Новых LLM-вызовов нет.

---

## Как проверить руками за 5 минут
1. `npm run build && npm run start` (или dev). Открыть `/robots.txt` и `/sitemap.xml` — 200, в sitemap нет `/i /p /b /dashboard /api /compare`.
2. `/designers` → исходный HTML: один `<title>` с « — ARHIDOM», `<link rel="canonical">`, `og:image` указывает на `/designers/opengraph-image`, есть JSON-LD `FAQPage` + `Organization/WebSite/SoftwareApplication`.
3. Открыть `/designers/opengraph-image` (и любой `/guides/*/opengraph-image`) — PNG 1200×630 с **читаемой кириллицей** (не квадраты).
4. `curl -I /login` и `/i/abc` — заголовок `X-Robots-Tag: noindex, nofollow`; у `/compare/teroom-vs-arhidom` в HTML `<meta name="robots" content="noindex, nofollow">`.
5. Пройти `/product/passport`, `/for-clients`, `/compare/teroom-vs-arhidom` — секции, карточки, таблица и FAQ на месте, дизайн совпадает с лендингом.

Проверено в этой сессии: `build` / `lint` / `typecheck` зелёные, `test` — 57 passed. OG-картинки (дефолт + eyebrow-вариант) отрендерены и визуально подтверждены; страницы отскриншочены.

---

## Известные ограничения / что осталось владельцу
- **Шрифт OG** — в репозитории лежат срезы Golos Text 600 (cyrillic+latin). Если бренд поменяет шрифт — заменить файлы в `app/_fonts/`.
- **`/compare/teroom-vs-arhidom`** — намеренно `noindex` и вне sitemap: текст на уровне категорий, без непроверенных утверждений о Teroom. Снять noindex и добавить в `app/sitemap.ts` только **после фактчека** конкретных возможностей конкурента.
- **`/solutions/changes`** — описание сознательно смягчено под факт (нет полноценной истории версий по этапам; это стадия пресейла). Не возвращать формулировки про «кому новая версия», пока такой функции нет.
- **Env/Vercel** — выставить `NEXT_PUBLIC_SITE_URL=https://arhidom.space`, апекс сделать Primary Domain (www → апекс), после деплоя отправить sitemap в Яндекс.Вебмастер и GSC, проверить `site:` что `/i /p /dashboard` не в индексе.
- **Демо-инструменты** `/demo/brief` и `/demo/proposal` уже проиндексируемы; страницы модулей M2–M4 намеренно не создавались (честность — не индексировать несуществующее).

## Вопросы к владельцу
1. Подтвердить `NEXT_PUBLIC_SITE_URL` и Primary Domain в Vercel до деплоя.
2. Нужен ли `/compare/*` в индексе — если да, дайте проверяемые факты по Teroom, тогда сниму noindex.
