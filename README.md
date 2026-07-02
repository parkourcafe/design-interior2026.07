# AI-квалификация клиента и сборка КП для интерьерных дизайнеров (MVP v0.1)

Pre-sale контур **Бриф → Цена → КП**: дизайнер отправляет клиенту ссылку → клиент проходит quick brief → система строит паспорт проекта и карточки рисков → дизайнер на Review Board принимает/отклоняет риски → собирает и отправляет коммерческое предложение.

Слой **до** дизайна: до чертежей, визуализаций и закупок. Спецификация проекта — в [`CLAUDE.md`](./CLAUDE.md).

## Стек

- Next.js 14 (App Router), TypeScript strict, Tailwind
- Supabase: Postgres + Auth (magic link) + Storage, RLS
- LLM продукта: **YandexGPT** (Yandex Cloud Foundation Models); GigaChat — задокументированный запасной. За интерфейсом `lib/llm/provider.ts`
- Vitest, ESLint, деплой на Vercel

## Быстрый старт

```bash
npm install
cp .env.example .env.local   # заполнить реальными ключами
# применить supabase/migrations/0001_init.sql к своему проекту Supabase
npm run seed                 # демо-дизайнер demo@studio.ru
npm run dev
```

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | локальный сервер |
| `npm run build` | production-сборка |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` | Vitest (unit-логика) |
| `npm run seed` | демо-дизайнер с pricing/proposal_defaults |
| `npx tsx eval/run-eval.ts` | mini-eval: бриф → карточки → `eval/phase1_results.md` |

## Структура

```
app/                    # маршруты (App Router)
  login, auth/callback  # magic-link вход
  dashboard/            # кабинет дизайнера: проекты, review board, proposal, setup
  i/[token]/            # публичный intake (бриф без регистрации)
  p/[public_token]/     # публичное КП (+ печать)
  api/intake/*          # server routes intake (сверка токена, service role)
  api/health            # healthcheck
lib/
  brief/                # questions, buildPassport, pipeline
  risks/                # rules, llm, schema, dedupe
  pricing/              # calcPrice
  proposal/             # buildProposalSections
  llm/                  # provider (YandexGPT + GigaChat-заглушка)
  supabase/             # browser / server / admin клиенты
  i18n/ru.ts            # все строки UI
supabase/migrations/    # схема + RLS
scripts/seed.ts         # seed
eval/                   # mini-eval
```

## Документы

- [`CLAUDE.md`](./CLAUDE.md) — спецификация v0.1 (источник истины)
- [`DEMO.md`](./DEMO.md) — сквозной сценарий демо
- `PHASE_0..3_REPORT.md` — отчёты по фазам
- [`BACKLOG.md`](./BACKLOG.md) — что отложено и почему

## Границы v0.1

Без биллинга, мультивалютности/EN, ML-pricing, генерации изображений, спецификаций, marketplace. В runtime продукта — только российские LLM (YandexGPT/GigaChat). Полный список — в `CLAUDE.md` («Что НЕ строить») и `BACKLOG.md`.
