# ARHIDOM QA / RuStore Readiness Review

Дата проверки: 2026-07-10 (локальное время), 2026-07-09 UTC в машинных отчётах.

## Вывод

Кодовая ветка локально выглядит рабочей для публичной витрины, демо-брифа, демо-КП и PWA/TWA endpoint-ов. Для отправки в RuStore текущий production-домен пока не готов: `www.arhidom.space` отдаёт старый манифест, не имеет `/.well-known/assetlinks.json`, а новые demo routes на нём возвращают 404.

Полная проверка кабинета дизайнера и настоящих клиентских ссылок не закрыта без тестового аккаунта и реальных Supabase env в локальном окружении.

## Что проверено

- Локальная production-сборка: `http://127.0.0.1:3000`.
- Desktop viewport: 1440x1100.
- Mobile viewport: 390x844.
- Снято 40 базовых screenshots и 44 дополнительных scroll-screenshots.
- Проверено 30 route screenshots, 135 внутренних переходов, 5 store/TWA endpoints.
- Пройдены сценарии: мобильное меню, demo brief, demo proposal, login boundary, pilot form.

Артефакты:

- Screenshots: `qa-artifacts/rustore-qa-2026-07-09/screenshots`
- Scroll screenshots: `qa-artifacts/rustore-qa-2026-07-09/screenshots/scroll`
- Машинный отчёт: `qa-artifacts/rustore-qa-2026-07-09/reports/qa-summary.md`
- JSON: `qa-artifacts/rustore-qa-2026-07-09/reports/qa-results.json`

## Глазами клиента

PASS:

- `/demo/brief`: стартовый экран, 7 шагов брифа и финальный экран проходят.
- `/demo/proposal`: КП читается на mobile; кнопки `Принять предложение`, `Обсудить`, `Запросить правки` работают.
- Мобильный первый экран главной читаемый: CTA видны без скролла, текст не наезжает.
- Мобильное меню открывается и содержит все основные разделы.

Не закрыто:

- Реальные `/i/[token]` и `/p/[public_token]` локально не проверены, потому что локальный сервер был поднят без Supabase env. Fake-token routes дали 500 из-за `supabaseUrl is required`, а не штатный 404/empty state.
- На preview-деплое с Supabase env fake `/i/fake-token` и `/p/fake-token` дают ожидаемый 404.

## Глазами дизайнера

PASS:

- Публичные страницы `/designers`, `/studios`, `/security`, `/pilot`, `/demo`, legal pages открываются в desktop/mobile.
- `/login` визуально нормальный в desktop/mobile: Google, пароль, код на почту, поля и CTA помещаются.
- Публичная форма `/pilot#request` после заполнения показывает готовый текст заявки и mailto/copy fallback.

Не закрыто:

- Полный кабинет `/dashboard`, создание проекта, Review Board, setup и proposal editor требуют тестового аккаунта. Без Supabase env локально `/dashboard` возвращает 500 до редиректа.
- На preview-деплое с Supabase env unauthenticated `/dashboard` даёт ожидаемый 307 redirect на `/login`.

## Переходы

Локально: 134/135 переходов PASS.

FAIL:

- `/dashboard` в unauthenticated local QA: 500 из-за отсутствующих Supabase env. На preview с валидными env поведение штатное: 307 на `/login`.

## Скорость

Локальная production-сборка:

- `/`: 646 ms load, 179 ms DCL, но FAIL в отчёте из-за двух aborted requests к hero mp4.
- Остальные ключевые страницы PASS: 323-402 ms load, DCL 136-147 ms.

Live HTTP checks:

- Preview URL:
  - `/`: 200, TTFB 0.138s, total 0.212s, 232 KB.
  - `/demo/brief`: 200, TTFB 0.738s.
  - `/demo/proposal`: 200, TTFB 0.741s.
  - `/manifest.webmanifest`: 200, TTFB 0.134s.
  - `/dashboard`: 307 на `/login`.
- `www.arhidom.space`:
  - `/`: 200, TTFB 0.134s, total 0.157s, but это старая версия.
  - `/demo/brief`: 404.
  - `/demo/proposal`: 404.
  - `/dashboard`: 307.

Проблема скорости/медиа:

- На главной браузер дважды abort-ит один CloudFront mp4. Время загрузки хорошее, но для store-quality лучше либо self-host через `NEXT_PUBLIC_MEDIA_BASE=/landing`, либо проверить, что видео стабильно грузится с production CDN.

## RuStore / TWA

Локально:

- `/manifest.webmanifest`: PASS.
- `/icons/192`, `/icons/512`: PASS.
- `/.well-known/assetlinks.json`: PASS только с тестовым env `ANDROID_PACKAGE_NAME=space.arhidom.twa`, `ANDROID_CERT_SHA256=AA:BB`.

Preview URL:

- Новый ARHIDOM manifest: PASS.
- `/.well-known/assetlinks.json`: 200, но тело `[]` — Android env не заданы.

Production `www.arhidom.space`:

- Manifest старый: `name = "Свод — Бриф · Цена · КП"`, `start_url = "/dashboard"`.
- `/.well-known/assetlinks.json`: 404.
- `/demo/brief` и `/demo/proposal`: 404.

Итог: production пока не готов к RuStore/TWA.

## Блокеры Перед Подачей

1. Довести текущую ARHIDOM-ветку до production-домена `www.arhidom.space`.
2. Настроить в Vercel production env:
   - `ANDROID_PACKAGE_NAME`
   - реальный `ANDROID_CERT_SHA256` для RuStore signing key
   - Supabase env
   - LLM env
3. После деплоя проверить, что `https://www.arhidom.space/.well-known/assetlinks.json` возвращает не `[]` и не 404.
4. Дать тестовый дизайнерский аккаунт, чтобы пройти `/dashboard`, создание проекта, реальную `/i/[token]`, Review Board и `/p/[public_token]`.
5. Принять решение по медиа: оставить Higgsfield/CloudFront или перенести в `public/landing` и включить `NEXT_PUBLIC_MEDIA_BASE=/landing`.

## Визуальные Замечания

- Критичных наложений/сломанных кнопок на проверенных screens не найдено.
- Мобильный hero крупный, но CTA виден и текст помещается.
- На desktop главная очень кинематографичная: есть большие тёмные паузы между смысловыми блоками. Это не баг, но для store/reviewer-а может ощущаться менее утилитарно.
- Desktop navigation плотная; tagline рядом с логотипом выглядит зажатым, но переходы работают.
