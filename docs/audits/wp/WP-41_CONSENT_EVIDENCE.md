# WP-41 consent — repository-only implementation

Дата: 2026-09-11. Ветка: `wp/wp-41-consent-records`.
База: `5ebd0f5547aa5461cbedcef6e315164f117a0c68`, PR #144.
CONTEXT_MODE: repository_only. Central Memory недоступна; binding не придуман.

## Разрешённый scope

Владелец ответил «da» на конкретное разрешение серверной фиксации согласий,
additive migration, локальных/disposable проверок, commit/push и PR без merge
и production. Allowlist расширен в карточке WP-41. Slot S-MIG #7 / DB4 #60 /
`20260911090000_remhaos_consent_receipts.sql`.

## Контракт

- Неизменяемый реестр хранит точный текст, SHA256, редакцию, purpose и снимок
  оператора. Активация — отдельная запись с явно заданным capability lifetime.
  Это срок доступа браузера, не юридическое решение о сроке хранения данных.
- Approved документов и active requirements в миграции нет. Проекты #144 не
  зарегистрированы как approved. `REMHAOS_CONSENT_ENABLED=false` по умолчанию.
- При enabled без действующей редакции приложение закрывает обработку; ошибки
  БД не превращаются в разрешение. Выключенный флаг сохраняет legacy поведение,
  не свидетельствует о действующем механизме согласий.
- Intake receipt привязан к проекту/токену и 256-bit HttpOnly browser proof.
  В БД только хеши токена/доказательства; receipt UUID не является полномочием.
  Другой браузер с тем же intake token не наследует согласие. Это доказательство
  владения браузерным секретом, не идентификация физического лица.
- Заголовок X-Intake-Token проверяется до разбора JSON/файла; body/form token
  должен совпасть. Проверка предшествует answers, storage и AI вызовам.
- До Auth — отдельная псевдонимная account-purpose browser receipt. После Auth
  требуется новое явное согласие от auth.uid; email/metadata/preauth не
  превращаются автоматически в доказательство согласия аккаунта.
- Withdrawal — append-only. Историческая запись доступна владельцу proof/actor
  для отзыва даже после смены редакции или истечения/ротации intake token.
  Отзыв не является удалением персональных данных или автоматическим стиранием
  аудита. Account deletion и recovery остаются доступны через application gate.
- Application gate защищает human HTTP flows; public token/system hooks имеют
  отдельные существующие контракты. Direct Supabase Auth/PostgREST/Storage не
  становятся защищёнными этим proxy. Upstream OAuth сбор данных не контролируется
  приложением. Shared Auth settings и RLS других продуктовых таблиц не изменялись,
  кроме узкого SELECT-only доступа NOLOGIN definer owner к intake scope.
- App flag — только HTTP gate; DB запись дополнительно требует active requirement.
  Direct public RPC имеет свой SQL scope и operational quotas. Не выдаём HTTP
  origin/rate-limit за защиту прямого RPC или полное предотвращение анонимного spam.

## Открытые gates

LEGAL/R23/RETENTION: утверждённые документы, регионы/подрядчики/основания и сроки
хранения по категориям ещё не подтверждены этим пакетом. Новые обязательства
не выбраны за владельца. ACTIVATION: отдельно согласовать документы, capability
lifetime, эксплуатационные лимиты/периметр и exact deployed SHA. MERGE и
shared/production deployment — отдельное разрешение. Ни одного такого действия
в этом пакете не выполнялось.

## Проверки

IN_PROGRESS: финальный release:check, DB4/DB5 PG16+PG17, CI, независимое
security review окончательного diff. Предварительные находки исправляются;
их устранение будет проверено на финальном снимке.

## Итог локальной верификации

VERIFIED 11.09.2026:
- `npm ci --cache /private/tmp/wp41-consent-npm-cache`: PASS; lockfile unchanged.
  Audit existing dependencies: 12 findings (3 moderate / 8 high / 1 critical),
  не исправлялись изменением dependency scope.
- `NEXT_DIST_DIR=.next.nosync npm run release:check`: PASS; lint 0 errors,
  13 прежних warnings; typecheck PASS; 212 files, 1708 tests passed / 10 skipped;
  build PASS. Сборка не содержала реальных production env/credentials.
- DB4 PG16 и PG17: полный PASS включая consent scope/negative tests,
  concurrent idempotency + withdrawal replay, upgrades/restart.
- DB5 PG16 и PG17: полный PASS включая default deny before/after.
- SQL SHA256: `7c4377bc71ade36cfdea583ce6722500cfec989d3d84e9b823f85f6b64c4f201`.
  Ledger обновлён; существующие migration hashes не изменены.
- Impeccable новых consent surfaces/login: 0 findings. Два прежних паттерна
  wizard (bounce easing / width transition) не менялись; suppressions нет.
- Независимый blind review из изолированной копии выявил P2: недоступный
  withdrawal UI после завершения/утраты проекта и потерю browser proof при
  потерянном ответе INSERT. Добавлены независимый management route и доставка
  proof в отдельном status response ДО записи; acceptance без proof запрещён.
  Повторное независимое review: PASS, 80/80 scoped tests, новых findings нет.
  Ревьюер отдельно SQL/hosted browser не запускал; DB evidence выше — исполнителя.
- Локальный production-mode browser, enabled без конфигурации/документа:
  account consent блокирует продолжение и показывает недоступность документа.
  Management `/i/disposable-missing-token/consent` доступен без проекта,
  без полей сбора данных/overflow. Положительный новый UI проверен jsdom tests;
  hosted enabled E2E не проводился, production readiness не заявлена.
- Первые параллельные DB4/DB5 прогоны упёрлись в заполнение локальной VM.
  Удалены 9 точно отобранных неиспользуемых volumes этого запуска; старые volumes
  и caches сохранены. Последовательные полные повторные прогоны PASS.
  DB4 cleanup теперь удаляет собственные anonymous volumes вместе с контейнером.

Текущий срез: LOCAL_GATES_PASS / READY_FOR_CI. Полный WP-41 остаётся
BLOCKED_ON_OWNER для юридической редакции, R23/retention и activation/merge.
При live проверке #144 уже ready (не draft), но OPEN; его статус не менялся нами.
Новый PR зависит от ветки #144; самостоятельное слияние не выполняется.
