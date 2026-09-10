# WP-03 — ПДн из env-дефолтов — EVIDENCE

Дата: 2026-09-10. Ветка: `wp/wp-03-pii-env-defaults`. База: `main@bd10f83`.
Implementation HEAD: `52e18ad`. PR: `PENDING`.

## Основание

[ИЗВЛЕЧЕНО] WP-03 / трек 0.12 требует убрать реальные публичные реквизиты
оператора из `lib/env.ts` и `.env.example`, добавить нейтральные fallback-значения,
полноту env-примера и release-тест.

## Allowlist по факту

```text
.env.example
lib/env.ts
tests/release/legal-operator-env.test.ts
docs/audits/wp/WP-03_EVIDENCE.md
```

[ИЗВЛЕЧЕНО] Все четыре файла входят в allowlist карточки WP-03.

## Хотспоты, пины и миграции

[ИЗВЛЕЧЕНО] `supabase/config.toml`, H1-H18, migrations, ledger и CI workflow
не менялись. Пинов и миграции нет.

## Реализация

[ИЗВЛЕЧЕНО] `supportEmail()` и `legalOperator()` читают публичные значения из
окружения. При пустом production env они предупреждают только по имени
переменной и возвращают нейтральные placeholders без ПДн.

[ИЗВЛЕЧЕНО] `.env.example` содержит нейтральные placeholders для support,
legal operator и Apple Team ID, а также документирует десять ранее отсутствовавших
runtime-переменных и их закрытые/default значения.

## Локальные гейты

[ИЗВЛЕЧЕНО] `npx vitest run tests/release/legal-operator-env.test.ts`: 4 tests
passed. `npm run typecheck`: exit 0.

[ИЗВЛЕЧЕНО] `npm run release:check`: exit 0; lint — 0 errors и 13
существующих warnings; typecheck — pass; 203 test files, 1615 passed и 10
skipped; production build — pass.

[ИЗВЛЕЧЕНО] Дополнительный изолированный build с неперсональными test env
значениями прошёл. Локальный `next start` вернул эти значения на `/support`,
`/legal/privacy` и `/legal/terms`; три HTTP/content проверки — `PASS`.

## CI и review

[ИЗВЛЕЧЕНО] PR CI: `PENDING`. Review: `PENDING`.

## Grep-проверки

[ИЗВЛЕЧЕНО] В целевых `.env.example` и `lib/env.ts` нет `gmail.com` и строк,
совпадающих с `\+\d{9,}`. Широкий поиск по всему `lib` находит существующую
test fixture в `lib/risks/llm.test.ts`; файл не входит в allowlist WP-03 и
runtime fallback не содержит.

## Не сделано / owner gate

[ИНТЕРПРЕТИРОВАНО] Реальные реквизиты в Vercel env не выставлялись. До merge
владелец должен выполнить Р9 и подтвердить значения; production и deploy этим
пакетом не затрагиваются.

## Безопасность

[ИЗВЛЕЧЕНО] Production, shared DB, Vercel credentials и secrets не использовались.
Evidence не содержит прежних персональных значений.
