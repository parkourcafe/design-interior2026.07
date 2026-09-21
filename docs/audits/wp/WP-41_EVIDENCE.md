# WP-41 — юридические страницы: repository-only подготовка

Дата: 2026-09-11. База: `e5e8d79b5888431856fff137e1ec8285e2b534e2`.
Ветка: `wp/wp-41-legal-block`. CONTEXT_MODE: repository_only.

## Основание и границы
[ИЗВЛЕЧЕНО] Владелец запросил подготовку юридических страниц, реквизитов и ссылок
у форм и подтвердил «go». Публикация — после отдельного разрешения.
[ИЗВЛЕЧЕНО] WP-03 уже в main. WP-41 требует юридическую редакцию и R23.
[ИЗВЛЕЧЕНО] Charter §12: российский data plane остаётся отдельным gate.
DEC-026 в журнале решений — PROPOSED; сроки хранения не утверждены.
[ИНТЕРПРЕТИРОВАНО] Подготовка draft разрешена; юридическую силу документов и
соответствие production 152-ФЗ эта ветка не устанавливает. Доступ к Central Memory
недоступен; project binding и решения из неё не придуманы.

## Разрешения
| Действие | Статус |
|---|---|
| Локальная подготовка, тесты, независимое review, commit/push/draft PR | ALLOWED |
| Изменение Auth, security, миграция consent receipt | OWNER_GATE |
| Merge этой юридической редакции | OWNER_GATE |
| Vercel env / production / shared DB / deploy | OWNER_GATE |
| Платные вызовы, новые зависимости, новые юридические обязательства | OWNER_GATE |

## Allowlist / изменения
[ИЗВЛЕЧЕНО] Расширение оркестратором записано в карточке WP-41.
- app/legal/**, app/support/page.tsx: проекты документов, общий блок реквизитов,
  noindex; отсутствующий адрес и фиктивные mailto/tel не публикуются.
- lib/env.ts и .env.example: необязательные ИНН/ОГРНИП/регистрация из окружения;
  статические NEXT_PUBLIC обращения для клиентского бандла, без личных дефолтов.
- lib/i18n/ru.ts: только landing.legal.
- wizard.tsx и login/page.tsx: только информационные ссылки, не Auth и не consent enforcement.
- tests/release/{legal-operator-env.test.ts,legal-pages.test.tsx,account-delete-and-associations.test.ts}.
- Карточка и этот evidence. Миграций, SQL, CI/config/hook изменений нет.

## VERIFIED: фактическая обработка
| Поверхность | Основание | Ограничение |
|---|---|---|
| Supabase Auth/DB/Storage | lib/supabase/server.ts; delete route | Hosted регион/SMTP неизвестны |
| AI | lib/llm/provider.ts; yandex.ts; zai.ts; gigachat.ts | Yandex default; Z.ai реализован; GigaChat stub; production выбор неизвестен |
| Контекст AI | lib/risks/llm.ts | Фильтрация отдельных полей, не полное обезличивание |
| Google Fonts / CDN | app/layout.tsx; components/landing/media.ts | Внешние запросы браузера; юрлицо CDN из URL не установлено |
| Локальные черновики | app/i/[token]/wizard.tsx | localStorage не очищается серверным удалением |
| События | intake/start, intake/submit, dashboard/analytics | Нельзя заявлять отсутствие аналитики |
| Удаление | app/api/account/delete/route.ts | legacy uploads/content; сохраняемые UUID; Auth soft delete |

[ИЗВЛЕЧЕНО] Удаление не доказывает очистку Project Intelligence, quarantine,
внешних копий, аудита и backups. При ошибке возможна частичная обработка.
Старые публичные утверждения о полном необратимом удалении уточнены.
[ИЗВЛЕЧЕНО] Полная выписка ЕГРИП, договоры подрядчиков, уведомление РКН,
production регионы и retention jobs в этом пакете не проверены.

## Следующий срез: контракт фиксации согласия (ПРЕДЛОЖЕНИЕ)
[ИНТЕРПРЕТИРОВАНО] Нужен отдельный security/migration gate; реализация не начата.

1. Реестр редакций: purpose + version + hash конкретного неизменяемого текста,
   operator identity и дата действия. Новая редакция не изменяет прежний receipt.
2. Receipt: server UUID, actor или token-scoped project scope, purpose/version/hash,
   server accepted_at. Actor/project выводятся сервером; клиент не назначает scope.
   Текст/PII/raw token не добавляются в общий журнал событий. Withdrawal — отдельная
   append-only запись; основания и сроки хранения должен утвердить владелец.
3. `POST /api/intake/submit`: только literal true и действующая версия; receipt
   должен быть сохранён до ответов/AI; идемпотентность повторов; ошибка persistence
   не допускает продолжение pipeline. Перед upload — проверяемый серверный receipt.
4. Нельзя ограничиться `/api/auth/register`: login сейчас вызывает browser signUp.
   Password, OTP и OAuth должны иметь согласованный единый onboarding checkpoint;
   существующий login не должен превращаться в новое согласие без основания.
5. Отдельная additive migration с default-deny grants, scoped append-only доступом,
   retention решением; timestamp/S-MIG не выделены. Не использовать редактируемый
   answers.contact.consent или user_metadata как единственное доказательство.
6. Проверки: false/string/missing/version mismatch; прямой submit/upload; подмена
   проекта/актора; replay/concurrency; ошибка БД; OAuth/OTP; новая версия и restored
   local draft. После разрешения — DB4/DB5 PG16/17, AP5 и независимое security review.

## Открытые owner gates
| Gate | Что требуется | Что блокирует |
|---|---|---|
| LEGAL_TEXT | Утвердить конкретные проекты privacy/terms/consent после юридического review | Merge/publication юридической редакции |
| R23 | Подтверждённый RU data plane, фактические подрядчики/страны/основания | Production сбор и окончательная privacy |
| RETENTION | Утверждённые сроки по категориям, audit/backups и правовые основания | Окончательный текст и consent receipt schema |
| REGISTRATION | Свежая выписка ФНС, проверенные реквизиты и допустимый адрес | Финальная публикация реквизитов |
| CONSENT_SECURITY | Отдельное разрешение на описанный receipt/Auth/SQL контракт | Серверная фиксация согласия |
| PRODUCTION | Разрешение на конкретный reviewed SHA и env значения | Deploy/config |

## Гейты
[ИЗВЛЕЧЕНО] npm ci с изолированным cache: PASS. Стандартный cache недоступен
по правам; права ~/.npm не менялись. Audit сообщил 12 уязвимостей существующего
lockfile (3 moderate, 8 high, 1 critical); dependencies не обновлялись.
[ИЗВЛЕЧЕНО] Первый release:check: PASS (lint 0 errors/13 existing warnings;
204 test files, 1626 tests passed/10 skipped; build PASS). После финального diff
результат будет уточнён ниже.
[ИЗВЛЕЧЕНО] Impeccable CLI через npx отсутствует; запущен установленный локальный
scripts/detect.mjs. На wizard найдены два существующих паттерна на строке 275:
bounce easing и transition width; эта строка не изменялась. Подавления не добавлены.
[ИЗВЛЕЧЕНО] DB4/DB5 локально не запускались: SQL/ACL/Auth runtime не менялись.

## CI и review
[ИЗВЛЕЧЕНО] До PR CI для этой ветки не запускался. Локальные проверки не заменяют CI.
[ИЗВЛЕЧЕНО] Независимые read-only аудиты consent и data flow выполнены по исходникам.
Final implementation review и browser QA — IN_PROGRESS.

## Состояние
[ИНТЕРПРЕТИРОВАНО] Технический срез IN_PROGRESS; полный WP-41 BLOCKED_ON_OWNER.
Следующее действие: завершить локальные гейты и независимое review, открыть draft PR.
Production и юридическое утверждение не выполнены.

## Итог технической подготовки
[ИЗВЛЕЧЕНО] Независимый implementation review (изолированная копия без журналов
решений и предыдущих выводов): P2 — фиктивный mailto в общем footer. Исправлен;
повторное review: замечаний нет, 23/23 focused tests PASS. Полные проверки ревьюер
не запускал; правовой вердикт не выдавал.
[ИЗВЛЕЧЕНО] Финальный `npm run release:check`: exit 0; 204 test files,
1628 passed / 10 skipped; lint 0 errors / 13 existing warnings; typecheck и build PASS.
Node 22.23.0, npm 10.9.8. Impeccable для legal/support/login/footer — exit 0,
без находок. Два прежних паттерна wizard перечислены выше, остаются вне link-only scope.
[ИЗВЛЕЧЕНО] В scope добавлен components/landing/footer.tsx; подтверждение в карточке.
[ИЗВЛЕЧЕНО] Локальная production-mode сборка .next.nosync с предоставленными
публичными реквизитами: PASS. Это локальное окружение, не production deployment.
В браузере privacy/terms/consent/support проверены при 390/768/1280 px: 12/12
без горизонтального overflow и фиктивных mailto; draft banner виден. Privacy
рендерит предоставленные ФИО/ИНН/ОГРНИП и контакты; адрес отсутствует.
Реквизиты передавались только в окружение локальной сборки, не в исходники.
[ИЗВЛЕЧЕНО] Первоначальный dev-preview остановился с EMFILE. Использована сборка
и next start без watcher. Автоматические добавления Next в tsconfig удалены;
конфигурационный diff отсутствует.
[ИЗВЛЕЧЕНО] Официальный поиск https://egrul.nalog.ru/index.html 11.09.2026
подтвердил соответствие предоставленного ИНН ФИО и записи ОГРНИП от 16.02.2017;
старая запись от 15.11.2012 имеет дату прекращения 07.06.2015. Полный PDF и
регистрирующий орган не проверены; не подменяем адрес оператора адресом налоговой.
[ИЗВЛЕЧЕНО] Обычный PR запускает существующий CI/disposable AP5 и OAuth-based
Claude review; hosted-staging только manual workflow_dispatch. Workflow не менялись.
[ИНТЕРПРЕТИРОВАНО] Технический срез PREPARED_FOR_REVIEW. Полный WP-41 остаётся
BLOCKED_ON_OWNER: юридическая редакция, R23, retention, отдельный consent/security
контракт, полный регистрационный документ/адрес и production approval.
