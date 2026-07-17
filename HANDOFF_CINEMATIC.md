# HANDOFF — Кинематографичный сайт ARHIDOM (для продолжения в новом чате)

Снимок на 07.07.2026. Этот файл — полная точка входа: GitHub, Vercel, структура,
медиа, env, что задеплоено и что осталось. Читать сверху вниз.

---

## 1. Репозиторий (GitHub)

- **Repo:** `parkourcafe/design-interior2026.07` (public)
  <https://github.com/parkourcafe/design-interior2026.07>
- **Владелец:** `parkourcafe` · parkourcafe@gmail.com
- **Default branch (= прод):** `claude/new-session-gsayp3` — **НЕ `main`!**
  `main` существует, но отстаёт (`2aa8338`) и НЕ используется для деплоя.
- **Рабочая ветка этой сессии:** `claude/arhidom-cinematic-website-t2zfdc`

### Состояние веток (на момент снимка)
| Ветка | SHA | Роль |
|---|---|---|
| `claude/new-session-gsayp3` | `c4c02d3` | **default + прод**, сюда влиты PR #41 и #42 |
| `claude/arhidom-cinematic-website-t2zfdc` | `095a5d0` | рабочая ветка лендинга (= прод по содержанию) |
| `main` | `2aa8338` | устарела, не трогать без причины |

### Смерженные PR этой работы
- **#41** — «Кинематографичный сайт ARHIDOM: тёмная скролл-история, демо-контур,
  ответ клиента на КП» → merged в `new-session-gsayp3`.
- **#42** — «Премиум-микровзаимодействия: свечение за курсором + сглаживание
  текста» → merged.
- Раньше (стадия «Пилот»): #37 триаж, #38 профиль-гейт, #39 лестница запуска,
  #40 consent ПДн.

### Git-правило для нового чата
Рабочая ветка — `claude/arhidom-cinematic-website-t2zfdc`.
Пушить: `git push -u origin claude/arhidom-cinematic-website-t2zfdc`.
Базовая ветка для PR — `claude/new-session-gsayp3` (default), НЕ `main`.
Если PR по ветке уже смержен — начинать новую работу от свежего default:
`git fetch origin claude/new-session-gsayp3 && git checkout -B claude/arhidom-cinematic-website-t2zfdc origin/claude/new-session-gsayp3`.

---

## 2. Vercel (деплой)

- **Проект:** `design-interior2026-07`, команда/скоуп `yulaboober`.
  Пример URL деплоя:
  `https://vercel.com/yulaboober/design-interior2026-07/<deployment-id>`
- **Прод-домен:** **arhidom.space** (основной). `arhidom.com` **НЕ привязан** —
  если нужен, добавить в Vercel → Settings → Domains и настроить DNS
  (A `76.76.21.21` или CNAME `cname.vercel-dns.com`), лучше redirect → .space.
- **Preview-домен:** `design-interior2026-07.vercel.app`.
- **Production Branch** в Vercel должен быть = `claude/new-session-gsayp3`
  (тот же, что default в GitHub). Если прод показывает старое — проверить это
  поле в Settings → Git, либо Promote to Production нужный деплой.
- Деплой автоматический по пушу/мерджу в прод-ветку. Статус последнего мерджа
  (#41/#42) на GitHub commit status = Vercel «Deployment has completed».
- ⚠️ Из облачной песочницы Claude arhidom.space **недоступен** (сетевой политикой
  режется всё, кроме dev-доменов) — живую проверку делает владелец в браузере
  или через дашборд Vercel.

---

## 3. Стек и запуск

- Next.js **14.2.15** (App Router, TS strict) · React 18 · Tailwind · Vitest.
- Node **v22** (в песочнице v22.22.2).
- Команды: `npm run dev | build | lint | typecheck | test | fetch:media`.
- Локально: `npm install && npm run dev` → <http://localhost:3000>.
- На момент снимка **build / lint / typecheck / test (55) — зелёные**.

---

## 4. Что построено — структура файлов

### Публичный кинематографичный сайт (новое)
```
app/page.tsx                      Главная: 18 секций (hero-видео, sticky-сцены, AIDA)
app/designers/page.tsx            Для дизайнеров
app/studios/page.tsx              Для студий
app/security/page.tsx             Как защищены данные (без фейк-сертификатов)
app/pilot/page.tsx                Пилот + форма заявки (#request)
app/pilot/pilot-form.tsx          Форма → событие pilot_request + письмо/копия
app/legal/privacy/page.tsx        Конфиденциальность (честные практики пилота)
app/legal/terms/page.tsx          Условия использования
app/demo/page.tsx                 Пресейл-контур за 2 минуты (8 шагов)
app/demo/brief/page.tsx           Демо-бриф глазами клиента
app/demo/brief/demo-wizard.tsx    Реальные вопросы (lib/brief/questions.ts), локально
app/demo/proposal/page.tsx        Demo КП
app/demo/proposal/respond-demo.tsx  Витрина CTA принять/обсудить/правки
app/api/pilot/route.ts            POST → событие pilot_request (rate limit 10/IP/час)
app/api/proposal/respond/route.ts POST → ответ клиента на КП (события, без миграций)

components/landing/
  cinema.tsx      Cine (reveal), StickyScene, Parallax, ReadingProgress, useScrollProgress, useReducedMotion
  cursor-glow.tsx Свечение за курсором (pointer:fine, reduced-motion aware)
  delay.ts        delay() — каскадные CSS-задержки (чистая функция, для серверных компонентов)
  nav.tsx         Шапка + мобильное меню + CursorGlow + ReadingProgress
  footer.tsx      Футер (supportEmail из lib/env)
  hero.tsx        Hero: видео + туман фраз + 3 плавающие карточки
  fog-scene.tsx   «Клиентский туман → структура» (sticky, мобильный статик-фолбэк)
  loop-scene.tsx  «Один бриф — весь пресейл» (sticky-паспорт, 5 кейсов)
  media.ts        Карта всех медиа-ассетов (CDN/локально)
```

### Изменённое в приложении (не новое, но правилось)
```
app/p/[public_token]/page.tsx     + ответ клиента + событие proposal_viewed
app/p/[public_token]/respond.tsx  Клиентские CTA принять/обсудить/правки
app/dashboard/projects/[id]/proposal/page.tsx  Бейджи «Клиент открывал КП» / «Ответ клиента»
lib/proposal/respond.ts           ACTION_EVENT / RESPONSE_TYPES (общие для роута/страниц)
components/pwa.tsx                 Промпт установки скрыт на /i /b /p /demo
app/layout.tsx                    metadata: title/description под ARHIDOM
lib/i18n/ru.ts                    app.name = ARHIDOM; весь блок ru.landing.*; pwa.*
tailwind.config.ts                Тёмная палитра: coal/ivory/bronze/olive/linedark
app/globals.css                   .landing, glass, glow-amber, cine, cursor-glow, grid-arch и т.д.
scripts/fetch-landing-media.mjs   Обновлён под новые файлы
.env.example                      NEXT_PUBLIC_SUPPORT_EMAIL, NEXT_PUBLIC_MEDIA_BASE
```

### Документы-отчёты
- `LANDING_REPORT.md` — детальный отчёт по сайту (проверка руками за 5 минут).
- Этот файл `HANDOFF_CINEMATIC.md`.
- `CLAUDE.md` — источник истины по продукту/стратегии/guardrails (читать в новом чате первым).

---

## 5. Медиа-ассеты (сгенерированы, не сток)

Генератор: **Higgsfield** (видео — Cinema Studio Video 3.0; изображения — Nano
Banana). Хостинг по умолчанию — CDN Higgsfield.

- **CDN base:** `https://d8j0ntlcm91z4.cloudfront.net/user_3EKntK4EDjG8nay4H1dy1TK30mB`
- **Карта имён → назначение:** `components/landing/media.ts`.
- Состав: hero-видео 10 c + постер, туман→структура, паспорт 4:5, риск-карточки,
  сборка КП, Review Board, клиентский бриф, pricing, ownership, data-safety,
  повестка встречи (итого видео + 11 изображений).
- **Свой хостинг (рекомендуется для независимости):**
  `npm run fetch:media` (скачает в `public/landing/`) →
  выставить `NEXT_PUBLIC_MEDIA_BASE=/landing` в env Vercel. Имена файлов
  совпадают, ссылки в коде менять не нужно.
- ⚠️ CDN Higgsfield — внешний; при желании убрать зависимость сделать шаг выше.

---

## 6. Переменные окружения (Vercel → Settings → Environment Variables)

Из `.env.example` (секреты в код не коммитятся):
```
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
LLM_PROVIDER (yandex|gigachat|zai) / LLM_MODEL / YC_FOLDER_ID / YC_API_KEY
GIGACHAT_AUTH_KEY · ZAI_API_KEY · ZAI_BASE_URL
NEXT_PUBLIC_APP_URL            (без хвостового слэша)
NEXT_PUBLIC_SUPPORT_EMAIL      контакт поддержки (футер, письма пилота, бриф)
NEXT_PUBLIC_MEDIA_BASE         пусто = CDN; /landing = свой хостинг
```
⚠️ **Действие владельца:** убедиться, что `NEXT_PUBLIC_SUPPORT_EMAIL`
(сейчас дефолт `support@arhidom.space`) реально принимает почту — туда идут
заявки на пилот и вопросы по данным. Иначе поставить свой (напр. gmail).

---

## 7. Продуктовые изменения (не только маркетинг)

- **Ответ клиента на публичном КП** `/p/[token]`: CTA «Принять / Обсудить /
  Запросить правки». Без миграций — ответ = событие в `events`
  (`proposal_accepted` / `proposal_discussion_requested` /
  `proposal_changes_requested`), первый ответ финальный. + `proposal_viewed`.
  Дизайнер видит бейджи в кабинете на странице КП. Это минимальное закрытие
  S3/S4 «Лестницы запуска».
- **PWA-промпт** больше не мешает клиенту на `/i` `/b` `/p` `/demo`.
- **Ребрендинг** «Свод» → **ARHIDOM** (одна точка: `ru.app.name`).
- Всё «принятое предложение», нигде не «подписанное КП» (e-signature нет).

---

## 8. Открытые вопросы / что осталось (для нового чата)

1. **Домен arhidom.com** — не привязан. Решить: нужен ли, и сделать redirect на
   .space (см. §2).
2. **Прод-ветка Vercel** — подтвердить, что Production Branch = `new-session-gsayp3`
   (если владелец видел старую версию — почти всегда причина здесь).
3. **support@arhidom.space** — проверить приём почты (§6).
4. **Медиа на свой хостинг** — `fetch:media` + `NEXT_PUBLIC_MEDIA_BASE=/landing`.
5. **Юрблок** (`/legal/*`) — честные практики пилота, но БЕЗ реквизитов оператора;
   полная редакция = блокер публичного запуска (стадия L1 в CLAUDE.md).
6. **Ответ клиента по КП** хранится событиями; полноценные статусы
   `accepted/declined` в `proposals.status` — отдельная миграция (если понадобится).
7. **Заявка на пилот** не пишет содержимое в БД (только факт события) — доставка
   письмом. Таблица лидов — кандидат в `BACKLOG.md`.
8. Идеи вне scope (маркетплейс, каталог, рейтинги, генерация интерьеров, CAD/BIM)
   — строка в `BACKLOG.md`, не код (guardrail CLAUDE.md).

---

## 9. Как быстро проверить руками (5 минут)

1. `/` (arhidom.space) — hero-видео, скролл: sticky-сцены, свечение за курсором.
2. «Попробовать бриф глазами клиента» → `/demo/brief` → пройти → «Создать
   настоящий бриф».
3. `/demo/proposal` → «Принять предложение» (демо, ничего не шлёт).
4. Реальный цикл: кабинет → проект → КП → «Отправить» → `/p/<token>` → ответить →
   вернуться в кабинет: бейдж «Ответ клиента».
5. `/pilot` → форма → «Отправить» → письмо/копия текста заявки.
6. Мобильная ширина: бургер-меню, статик-версии sticky-секций, нет свечения.

---

## 10. Первое действие в новом чате

1. Прочитать `CLAUDE.md` (guardrails/стратегия), затем этот файл и `LANDING_REPORT.md`.
2. `git fetch origin` и убедиться, что на `claude/arhidom-cinematic-website-t2zfdc`
   (или пересоздать от `origin/claude/new-session-gsayp3`).
3. `npm install` → `npm run build` (должно быть зелёным).
4. Работать по §8.
