# Аудит мобильного релиза ARHIDOM

## Идентичность релиза

- Приложение: ARHIDOM
- Дата и часовой пояс: 18 июля 2026, Asia/Makassar
- Каналы: Apple App Store (iPhone) и RuStore; территории ещё не зафиксированы в консолях
- Исходный репозиторий: HEAD `9470fce`, рабочее дерево содержит незавершённые изменения других задач
- Проверенная копия: изолированный snapshot исходного рабочего дерева с release-правками
- Production URL: `https://www.arhidom.space`
- iOS Bundle ID: `space.arhidom.ios`
- Android package-кандидат: `space.arhidom.twa` — окончательно подтвердить до первого релиза
- Версия: `1.0` / build `1`
- Android-артефакты проверки из основного репозитория: unsigned APK SHA-256 `e7b390b8978ba1ddc3cb87f14f2c3ca638626ba6216b462c6514df27d3da0026`; unsigned AAB SHA-256 `69ab3246d01c12750025689a1dc083d3529a67710fd100dce009a4ae98b9c500`
- Подписанные IPA/APK/AAB: отсутствуют

## Вердикт

**NO-GO для отправки в магазины.** Кодовый preflight пройден, но production ещё не содержит проверенную редакцию, Android и iOS не подписаны, Digital Asset Links production пустой, а реальные устройства не прошли чистую установку этой сборки.

## Состояние каналов

| Канал | Результат | Подтверждение |
|---|---|---|
| Apple App Store, iPhone | NO-GO | конфигурация исправлена, но нет успешного Archive/подписи и device QA |
| iPadOS | вне scope | Xcode target остаётся iPhone-only |
| RuStore | NO-GO | TWA собирается, но APK/AAB неподписаны и DAL production пустой |
| Production web/PWA | NO-GO | локальный release build исправен; текущий production не совпадает с ним |

## P0 — стоп релиза

1. Развернуть именно проверенный commit и подтвердить `200` для `/app`, `/support`, `/api/health`, AASA и непустого Digital Asset Links.
2. Создать и безопасно сохранить релизные ключи вне репозитория; собрать подписанные IPA и APK/AAB.
3. Зафиксировать одну чистую release-ветку/commit: магазинный binary, production и отчёт должны указывать на одну ревизию.

## P1 — обязательно проверить до отправки

1. Чистая установка и полный пользовательский сценарий на реальном iPhone и Android: регистрация, пароль, OTP, основной проект, файлы, возврат из background, logout и удаление аккаунта.
2. Xcode 26.3 локально видит iOS SDK 26.2, но `ibtool` сообщает, что платформа iOS 26.2 не установлена. Исправить установку Xcode и повторить unsigned build, Archive и Validate.
3. Удаление аккаунта очищает legacy-файлы, профиль и редактируемые данные, но Project Intelligence blobs по пути `project-intelligence/ru/.../sources/...` требуют отдельного авторизованного RPC и утверждённой retention-политики.
4. Для App Store остаётся риск Guideline 4.2: iOS использует удалённый web-продукт. До отправки проверить app-like UX и дать ревьюеру полный demo account/сценарий.
5. Проверить в консолях privacy/Data Safety, возрастной рейтинг, support/privacy URLs, договоры, региональные и юридические декларации. Не включать в карточку платежи или подписки: версия 1.0 их не содержит.

## P2 — после блокеров

1. Android lint: 0 ошибок и 6 предупреждений об outline legacy launcher icons; themed monochrome resource уже добавлен для Android 13+.
2. Подготовить магазинные скриншоты только после проверки подписанных сборок на реальных устройствах.

## Автоматические проверки

| Проверка | Результат |
|---|---|
| ESLint | PASS: 0 ошибок, 10 существующих warnings |
| TypeScript | PASS |
| Unit/integration | PASS: 69 файлов, 394 теста |
| Next.js production build | PASS; `/app`, `/support`, legal и association routes присутствуют |
| Локальные HTTP checks | PASS: `/app` → `/login`; support/legal/AASA/health отвечают корректно |
| Android Gradle | PASS: `lintRelease assembleRelease bundleRelease` |
| Android archive integrity | PASS: APK и AAB являются корректными ZIP-архивами |
| Android signature | ожидаемо отсутствует в preflight-артефактах |
| iOS plist/privacy/config | PASS: XML/JSON валидны; icon/splash RGB без alpha |
| iOS compile/archive | NOT CHECKED полностью: локальная Xcode platform ошибка |

## Не проверено

- App Store Connect и RuStore Console;
- уникальность/окончательность Android package ID;
- сертификаты, provisioning profiles, release fingerprints и подписанные store artifacts;
- реальные iPhone/Android, камера/файлы и медленная/прерванная сеть;
- финальные store metadata, скриншоты, DSA/региональные декларации и статус оператора персональных данных;
- production после будущего деплоя.

## Следующие действия владельца

1. Разрешить создание чистой release-ветки и production deployment после code review.
2. Подтвердить окончательный Android package ID до генерации ключа.
3. Отдельно разрешить создание signing assets и чистую установку на устройства.
4. После зелёного device QA отдельно разрешить действия в консолях магазинов. Публикация в рамках этого аудита не выполнялась.
