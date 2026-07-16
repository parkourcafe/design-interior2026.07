# Предрелизный аудит Apple App Store — 12.07.2026

## Вердикт

**Не готово к App Store submission.** Веб-продукт собирается и тестируется,
но iOS-приложения в репозитории нет. До появления подписанного iOS archive
оценивать crash-free launch, privacy manifest, entitlements и device UX нельзя.

## Findings

### P0 — нет загружаемого iOS-приложения

Репозиторий содержит Next.js PWA и Android TWA release pack. Отсутствуют Xcode
project/workspace, iOS target, bundle ID, signing и `.ipa`.

### P1 — нет удаления аккаунта внутри продукта

Регистрация аккаунта реализована, а self-service deletion не найден.
Apple требует, чтобы приложение с созданием аккаунта позволяло инициировать
удаление аккаунта внутри приложения.

### P1 — legal/privacy не готовы для публичного релиза

Страница privacy прямо сообщает, что это пилотный текст без реквизитов
оператора. До submission нужны реальные данные оператора, subprocessors,
retention и работающий процесс удаления/обращения пользователя.

### P1 — отсутствует Support URL с контактами

В App Store Connect требуется рабочий URL поддержки. В проекте есть email в
футере, но отдельной support page с проверяемыми контактами нет.

### P1 — невозможно проверить Apple privacy/signing

Нет `PrivacyInfo.xcprivacy`, entitlements, Info.plist, release scheme и списка
нативных SDK. Их нельзя корректно создать до выбора iOS-реализации.

### P2 — внешние runtime-ресурсы

Шрифты и часть landing media загружаются с внешних доменов. Для первого запуска
и слабой сети нужен проверенный offline/error UX; предпочтительно перенести
критичные ассеты на собственный домен.

### P2 — production dependency audit не подтверждён в этом прогоне

`npm audit --omit=dev` не получил registry response из изолированной среды.
Это environmental limitation, не доказанный дефект; повторить в CI/сети перед
релизным тегом.

## Проверки

- `npm run lint` — PASS
- `npm run typecheck` — PASS
- `npm run test` — PASS, 18 файлов / 94 теста
- `npm run build` — PASS (Next.js 16.2.10 production build)
- поиск секретов/debug/placeholder patterns — явных committed secrets не найдено
- iOS artifacts/config — NOT FOUND

Полный план закрытия блокеров и метаданные находятся в `APP_STORE_RELEASE.md`.
