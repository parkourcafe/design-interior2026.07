# APP_STORE_RELEASE — подготовка ARHIDOM к Apple App Store

Обновлено: 12.07.2026. Цель: первая публикация ARHIDOM для iPhone через
App Store Connect и TestFlight.

## Статус

**iOS source target готов.** Создан Capacitor/Xcode target с bundle ID
`space.arhidom.ios`, Apple Team `KB7VPWHTTM`, версией 1.0/build 1,
Associated Domains и `PrivacyInfo.xcprivacy`. Для отправки остаются Xcode
Archive, проверка на физическом iPhone и загрузка в TestFlight.

Веб-часть проходит lint, TypeScript, 94 unit-теста и production build.

## P0/P1-блокеры

1. Проверить Capacitor/WKWebView target на физическом iPhone и пройти Xcode
   Archive/Validate с аккаунтом команды `KB7VPWHTTM`.
2. Проверить self-service удаление аккаунта из настроек. Удаление должно
   охватывать пользователя и связанные проекты/ответы/файлы, с понятным
   подтверждением и политикой retention.
3. Юридический текст заполнен предоставленными реквизитами; перед публичным
   релизом желательно заменить «Бали, Убуд» на полный почтовый адрес с индексом.
4. Проверить юридический текст: subprocessors,
   контакты, сроки хранения, subprocessors, порядок доступа/исправления/
   удаления и трансграничной передачи по фактической инфраструктуре.
5. Создать страницу поддержки с реальными контактами. Support URL App Store
   должен вести на страницу с доступным способом связаться с разработчиком.
6. Провести iOS QA на реальном устройстве: первый запуск, вход, регистрация,
   magic link, загрузка файлов, камера/фотопикер (если появятся), offline,
   возврат из background, safe areas, клавиатура и удаление аккаунта.

## Конфигурация iOS target

- Display name: `ARHIDOM`
- Version: `1.0.0`; build: `1`
- Minimum iOS: выбрать при создании target и зафиксировать в документации
- Orientation: portrait как основной; iPad включать только после отдельного QA
- Universal Links: `applinks:arhidom.space` для auth/public links
- Associated Domains требуют рабочий
  `https://arhidom.space/.well-known/apple-app-site-association`
- ATS: только HTTPS, без произвольного allow-all
- Не добавлять permissions в `Info.plist`, пока функция реально их не требует
- Добавить валидный `PrivacyInfo.xcprivacy` по фактическим SDK/API
- Release scheme, automatic signing, distribution certificate/profile
- App icon 1024×1024 без прозрачности; полный iOS icon set; launch screen

## App Store Connect — готовые поля (RU)

**Название (до 30):** ARHIDOM

**Подзаголовок (до 30):** Пресейл для дизайнеров

**Категория:** Business; дополнительная — Productivity

**Promotional text (до 170):**

Бриф клиента, паспорт проекта, возможные риски, расчёт стоимости и
коммерческое предложение — в одном рабочем контуре интерьерной студии.

**Описание:**

ARHIDOM — рабочий инструмент интерьерного дизайнера и студии для этапа до
начала проекта.

Дизайнер отправляет клиенту ссылку на бриф. Клиент отвечает без регистрации,
а ARHIDOM превращает ответы в паспорт проекта, предлагает возможные риски,
помогает рассчитать стоимость по правилам студии и собрать коммерческое
предложение.

В приложении доступны:

- клиентский бриф без регистрации;
- паспорт проекта из ответов клиента;
- карточки возможных рисков по бюджету, срокам, стилю и функции;
- расчёт диапазона стоимости по настройкам студии;
- конструктор коммерческого предложения и публичная ссылка;
- ответ клиента на предложение.

AI предлагает — дизайнер утверждает. Решение всегда остаётся за дизайнером.

**Keywords (до 100 bytes, проверить после ввода):**

интерьер,дизайнер,бриф,клиент,проект,смета,КП,студия

**What’s New 1.0.0:**

Первый релиз ARHIDOM: клиентский бриф, паспорт проекта, карточки рисков,
расчёт стоимости и коммерческое предложение в одном пресейл-контуре.

**Privacy Policy URL:** `https://arhidom.space/legal/privacy`

**Support URL:** создать отдельную публичную страницу, например
`https://arhidom.space/support` (текущей страницы нет).

## App Privacy — черновик декларации

Финальные ответы сверить по network trace собранного iOS-приложения и всем
подключённым SDK. Сейчас продукт обрабатывает:

| Категория Apple | Linked to user | Tracking | Цель |
|---|---:|---:|---|
| Contact Info: email/name/phone | да | нет | account management, app functionality |
| User Content: answers, files, photos, comments | да | нет | app functionality |
| Identifiers: user ID | да | нет | authentication, app functionality |
| Usage Data: product interaction/events | да | нет | analytics/app functionality |

Не заявлять «Data Not Collected». Учитывать Supabase и выбранного LLM-провайдера
как сторонних обработчиков; описание должно соответствовать реальной передаче.
ATT/IDFA не нужны, пока нет рекламы и cross-app tracking.

## Review Information

Дать Apple отдельный стабильный аккаунт ревьюера и не включать 2FA/одноразовый
email-flow, который ревьюер не сможет завершить. До отправки заменить плейсхолдеры:

- Login: `<reviewer email>`
- Password: `<reviewer password>`
- Contact: `<name, phone, email>`

**Notes:**

ARHIDOM is a business workflow tool for interior designers. The public demo is
available without registration. For the authenticated workflow, use the review
account above. Suggested path: open Dashboard → existing demo project → review
the project passport and risk cards → open the proposal. No purchases or paid
digital content are offered in version 1.0. Account deletion is available in
Settings → Account → Delete account.

Последнее предложение допустимо только после реализации удаления аккаунта.

## Скриншоты

Подготовить 6–8 реальных скриншотов из release build на поддерживаемом iPhone:
главная, бриф, паспорт, Review Board, расчёт, КП и ответ клиента. App Store
принимает 1–10 изображений на размер/локализацию. Не показывать функции,
которых нет в submitted build. Если заявлен iPad — нужен отдельный iPad QA и
соответствующие скриншоты.

## Порядок выпуска

1. Закрыть юридический блок и account deletion.
2. Создать iOS target и owner-controlled bundle ID.
3. Добавить Universal Links, privacy manifest, icons и launch screen.
4. Прогнать release build, unit/integration tests и ручной device QA.
5. Archive → Validate App → Upload в App Store Connect.
6. Заполнить App Privacy, age rating, encryption/export compliance и metadata.
7. Загрузить TestFlight, пройти internal testing, затем external beta.
8. Дать Apple review account, заполнить notes и отправить version 1.0.0.

## Owner-ввод, без которого сборка невозможна

- Apple Developer Program Account Holder/Team ID
- окончательный bundle ID (после первой загрузки не менять)
- юридическое имя/адрес/контакты издателя и оператора данных
- рабочий support email/телефон
- решение: только iPhone или iPhone + iPad
- выбранный iOS wrapper/нативный стек
- reviewer account

## Официальные источники

- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Account deletion: https://developer.apple.com/support/offering-account-deletion-in-your-app
- App Privacy: https://developer.apple.com/app-store/app-privacy-details/
- Privacy manifests: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files
- Screenshots: https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots
