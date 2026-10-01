# T-REMH-02 — фикс CI (ripgrep) и SEO-правки кодом (запуск 3)

| Поле | Значение |
|---|---|
| task_id | T-REMH-02 (две подзадачи: T-REMH-CI и T-REMH-SEO) |
| repo | parkourcafe/design-interior2026.07 |
| base SHA | `737795d7aa6bae3b6020010c6a53b4757ed99a48` (main, merge #209) |
| branch / PR | CI: `claude/remh-ci-ripgrep` · draft [#211](https://github.com/parkourcafe/design-interior2026.07/pull/211); cherry-pick в `claude/autonomy-remh-01` ([#210](https://github.com/parkourcafe/design-interior2026.07/pull/210)). SEO: `claude/remh-seo-quick-fixes` · draft [#212](https://github.com/parkourcafe/design-interior2026.07/pull/212) |
| дата | 28.09.2026 |
| среда | локальная песочница; Node 22, zsh 5.9 и docker (dockerd) поставлены/запущены в песочнице; без `.env`, без секретов, без доступа к production |

Статусы: `DONE_CODE`, `TESTED_LOCAL`, `BLOCKED_EXTERNAL`, `BLOCKED_DECISION`, `NOT_VERIFIED`. Staging и production не проверялись.
**[факт]** — из файла или вывода команды; **[интерпретация]** — вывод исполнителя.

## 1. Статус

| # | Задача | Статус |
|---|---|---|
| CI | `ripgrep` в шаге установки джобы `lint / typecheck / test / build` | DONE_CODE + TESTED_LOCAL; CI-прогон — за координатором |
| SEO-а | sitemap только с индексируемыми страницами | DONE_CODE + TESTED_LOCAL |
| SEO-б | canonical / sitemap / robots / og:url на `https://www.remhaos.com` | DONE_CODE + TESTED_LOCAL (при `NEXT_PUBLIC_APP_URL=https://www.remhaos.com`); значение env в Vercel — BLOCKED_EXTERNAL |
| SEO-в | og:image + Organization JSON-LD | DONE_CODE + TESTED_LOCAL |
| SEO-г | 301 arhidom.space → канонический хост | DONE_CODE + TESTED_LOCAL; на живом домене — BLOCKED_EXTERNAL |
| SEO-д | внутренние ссылки на 22 интент-страницы | DONE_CODE + TESTED_LOCAL |

## 2. T-REMH-CI

**Диагноз [факт]:** `tests/ap1/environment/adopt-production.zsh:141` вызывает `rg -qx '1'` в цикле ожидания БД. Шаг `Install zsh` в `.github/workflows/ci.yml` (джоба gates) ставил только `zsh`, а DB-джобы — `zsh ripgrep`.

**Воспроизведение (локально):**
- без `rg` в PATH (zsh + docker + `postgres:16-alpine`): `adopt-production.contract.test.ts` → 1 failed / 7 passed; в stderr `adopt-production.zsh:141: command not found: rg`. Результат совпадает с падением в CI;
- с `rg`: `adopt-production.contract.test.ts` + `ci-secret-log.contract.test.ts` — 20/20 passed.

**Изменение:** шаг переименован в `Install zsh and ripgrep`, команда — `apt-get install -y --no-install-recommends zsh ripgrep`. Триггеры (`workflow_dispatch`) не тронуты. Коммит `70788c3` в `claude/remh-ci-ripgrep` перенесён в `claude/autonomy-remh-01` через `cherry-pick -x`.

## 3. T-REMH-SEO

### а) sitemap
**[факт]** `app/support/page.tsx`, `app/legal/privacy/page.tsx` и `app/legal/terms/page.tsx` содержат `robots: { index: false }`, но стояли в `app/sitemap.ts`. Эти три страницы убраны из sitemap. Решение закрыть их от индексации не менялось. Сейчас в sitemap 32 URL: 10 страниц и 22 интент-страницы.

### б) канонический хост
- **[факт]** sitemap, robots и canonical строятся от `appUrl()` (`lib/env.ts`). В production без env он возвращает `https://www.remhaos.com`, а `.env.example` задаёт то же значение.
- Canonical и og:url добавлены туда, где их не было: `/designers`, `/demo/brief`, `/demo/proposal`, `/security`.
- **Попутный дефект [факт, проверено в собранном HTML]:** страницы с `openGraph: { url }` целиком заменяли openGraph из layout, потому что Next сливает метаданные поверхностно. Из-за этого пропадали og:site_name, og:title и og:description. Исправлено хелпером `publicPageMetadata()` в `lib/seo/site.ts`.
- **[интерпретация]** Если в Vercel `NEXT_PUBLIC_APP_URL` указывает на хост без www или на arhidom.space, все canonical пойдут туда. Код это значение не перебивает: оно — часть конфигурации владельца.

### в) og:image и JSON-LD
- og:image и twitter:image — существующий постер героя `MEDIA.heroPoster` (`components/landing/media.ts`). Размер 2752×1536 взят из `app/manifest.ts`, где тот же файл объявлен скриншотом. Новых ассетов нет.
- Organization JSON-LD в `app/layout.tsx` содержит только `name` (RemHaOS), `url` (канонический) и `logo` (`/icons/512`, генерируется `app/icons/[size]/route.tsx`). Контактов и соцсетей нет, потому что в репозитории нет подтверждённых.

### г) редирект со старого домена
- **[факт]** ADR-0005 (`docs/product-intelligence/adr/0005-remhaos-public-brand.md:25`): «Старый домен должен перенаправлять на новый».
- `next.config.mjs` → `redirects()`: host `(www.)?arhidom.space` → `https://www.remhaos.com/:path`, код 301, query сохраняется.
- Исключения **[интерпретация, осознанный выбор]**:
  - `/api/*` — 301 превращает POST в GET и ломает клиентов;
  - `/auth/*` — cookie с PKCE code verifier лежит на старом origin, и magic link, выписанный на старый домен, сломался бы;
  - `/.well-known/*` — AASA/assetlinks проверяются на каждом хосте.
- Если `NEXT_PUBLIC_APP_URL` сам указывает на arhidom.space, правило не создаётся, чтобы не было цикла.
- **Побочный эффект для владельца:** сессия кабинета на arhidom.space не переносится. После редиректа дизайнер попадает на `/login` уже на www.remhaos.com.

### д) внутренние ссылки
**[факт]** Хабы `/for-clients` и `/guides` вместе перечисляют все 22 `PUBLISHED_INTENTS` (фильтр по segment), но в `components/` и `app/` на них не было ни одной ссылки. Ссылки на оба хаба добавлены в `components/landing/footer.tsx`: футер стоит на всех публичных страницах и оказался естественным хабом. Строки заведены в `lib/i18n/ru.ts` и `lib/i18n/public.ts` (en/id; остальные локали наследуют en).

## 4. Изменённые файлы

CI: `.github/workflows/ci.yml`.

SEO:
- `app/sitemap.ts`, `next.config.mjs`, `app/layout.tsx`, `app/page.tsx`;
- `app/{designers,studios,demo,demo/brief,demo/proposal,pilot,security}/page.tsx`;
- `lib/seo/site.ts` (новый), `lib/seo/page-metadata.ts`;
- `components/landing/footer.tsx`, `lib/i18n/ru.ts`, `lib/i18n/public.ts`;
- `tests/seo/sitemap-robots.test.ts` (новый), `tests/seo/legacy-host-redirect.test.ts` (новый);
- этот журнал.

Миграции, зависимости, lockfile, триггеры CI и аналитика не менялись.

## 5. Проверки (ветка SEO)

| Команда | Результат |
|---|---|
| `npm ci` | ok |
| `npm run lint` | 0 errors, 15 warnings — все в незатронутых файлах (dashboard, lib/llm, lib/risks, tests/…) |
| `npm run typecheck` | ok |
| `npm run test` | 259 файлов, 2351 тест, все прошли |
| `npm run build` (`NEXT_PUBLIC_APP_URL=https://www.remhaos.com`) | ok |
| `tests/seo/*` | 29/29; мутация (вернуть старый sitemap) → тест падает на `/support` |
| `next start` + curl с `Host:` | см. ниже |

Evidence со `next start` **[факт, вывод curl]**:
- `Host: arhidom.space` `/` → `301 https://www.remhaos.com/`
- `Host: www.arhidom.space` `/studios?utm_source=x` → `301 https://www.remhaos.com/studios?utm_source=x`
- `Host: arhidom.space` `/api/assetlinks`, `/.well-known/assetlinks.json` → 200, без редиректа
- `Host: www.remhaos.com` `/studios` → 200
- `/sitemap.xml` → 32 `<loc>`, ни одного `/support` или `/legal`; `robots.txt` → `Sitemap: https://www.remhaos.com/sitemap.xml`
- `/`, `/studios`, `/designers`, `/guides/pricing`: canonical, og:url, og:image, twitter:image и Organization JSON-LD — на `https://www.remhaos.com`

## 6. Не проверено

- Живой сайт: remhaos.com и arhidom.space закрыты сетевой политикой песочницы (BLOCKED_EXTERNAL).
- Фактическое значение `NEXT_PUBLIC_APP_URL` в Vercel production (BLOCKED_EXTERNAL).
- Порядок срабатывания: если Vercel уже редиректит arhidom.space на уровне домена, правило в коде просто не сработает. Это безвредно.
- CI на #211, #212 и #210 не запускался: запускает координатор.

## 7. Чек-лист владельцу (5 минут, после деплоя #212)

1. `curl -sI https://arhidom.space/studios` → `301`, `location: https://www.remhaos.com/studios`.
2. `curl -sI https://arhidom.space/.well-known/apple-app-site-association` → 200, без редиректа.
3. Открыть `https://www.remhaos.com/sitemap.xml`: 32 URL, все на `https://www.remhaos.com`, нет `/support` и `/legal/*`.
4. Исходный код `https://www.remhaos.com/studios`: `rel="canonical"` и `og:url` на `https://www.remhaos.com/studios`, есть `og:image`.
5. Rich Results Test / валидатор schema.org на главной: блок Organization без ошибок.
6. В футере любой публичной страницы есть ссылки «Заказчику: разборы» и «Дизайнеру: гайды».
7. После теста — переотправить sitemap в Search Console и Вебмастере.

## 8. Блокеры и решения владельца

- BLOCKED_EXTERNAL — живая проверка (п. 7 выше).
- BLOCKED_DECISION (новое, не блокирует PR): нужно ли на время переходного периода держать `/dashboard` на arhidom.space без редиректа, чтобы не разлогинивать дизайнеров. Сейчас он редиректится.
- Не трогались по условию: B5/B3, B7, D1–D5, R2-1…R2-3, аналитика (нужен ID от владельца).

## 9. Следующий шаг

Координатор запускает CI на #211 и #210; ожидается, что джоба gates станет зелёной. Затем владелец проходит чек-лист из п. 7 после деплоя #212.
