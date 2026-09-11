# WP-41 — Юрблок: privacy/terms/support из env, subprocessors, тест удаления аккаунта

| Трек/шаг | Волна | Оценка | Серия | Миграция |
|---|---|---|---|---|
| 4.2 (eng) | W5–W7 | 1–2 РС | S-RU | нет |

Контракт программы: `docs/execution/REMHAOS_MASTER_TZ_2026-09-08.md`. Карта: `docs/audits/REMHAOS_COMPLETION_ROADMAP_2026-09-08.md`. Аудит: `docs/audits/REMHAOS_GLOBAL_AUDIT_2026-09-08.md`.

## Цель
Страницы privacy/terms/support отражают факт: реквизиты из env, subprocessors, сроки хранения, порядок удаления; удаление аккаунта покрыто тестом.

## Входы (что должно быть выполнено до старта)
- WP-03 слит
- тексты юриста (владелец)
- Р23 — data plane

## Allowlist файлов (правишь только это)
- `app/legal/**`, `app/support/**`
- `app/api/account/delete/route.ts`
- H8 — `ru.legal.*`
- новый `tests/release/account-delete-and-associations.test.ts`
- `docs/audits/wp/WP-41_EVIDENCE.md`

## Запрещено
- остальные хотспоты

## Шаги
1. Subprocessors: Supabase (ap-northeast-1, Токио), Vercel, Resend, LLM-провайдер по env, Higgsfield CDN; сроки хранения — плейсхолдер до DEC-026; удаление — охват user/projects/answers/files (тест).

## Гейты
- полный CI

## Критерий приёмки
- Charter §18 п.7 evidence; страницы рендерят env-значения, не дефолты

## Обязательные правила (кратко; полностью — `docs/audits/wp/WP_PROTOCOL.md`)

- Ветка `wp/wp-41-legal-block` от свежего `origin/main`; один PR `WP-41: Юрблок: privacy/terms/support из env, subprocessors, тест удаления аккаунта`; squash; draft до локальных гейтов.
- Правишь только allowlist. Нужен другой файл — статус `BLOCKED_HOTSPOT`, в PR: файл, строки, причина, минимальный diff. Границу расширяет оркестратор.
- Grep-first: если цель уже отсутствует на `main`, зафиксируй это командой и выводом и заверши как no-op с evidence.
- Перед каждым push: `npm ci && npm run release:check`; DB4/DB5 локально, если задет SQL. Один push на веху.
- Production, `release`, prod-секреты, коннектор Supabase — запрещены. Строка `@claude` в PR запрещена.
- Evidence: `docs/audits/wp/WP-41_EVIDENCE.md` по `docs/audits/wp/WP_EVIDENCE_TEMPLATE.md`.
- Завершение сессии одной строкой: `WP-41: <статус> | PR #N | HEAD <sha> | blockers: …`.

## Repository-only подготовка от 11.09.2026

Основание: владелец поручил подготовить юридические страницы, реквизиты и ссылки у форм,
затем подтвердил «go». Это разрешение на техническую подготовку и draft PR,
не утверждение юридического текста, сроков хранения, R23, миграции или production.
Оркестратор расширяет allowlist для этого среза:

- `lib/env.ts`, `.env.example`, `tests/release/legal-operator-env.test.ts`: публичные
  регистрационные поля из env; статические обращения NEXT_PUBLIC для клиентской сборки.
- `app/i/[token]/wizard.tsx`, `app/login/page.tsx`: только информационные ссылки,
  без изменения Auth, API, записи согласия или порядка допуска.
- `tests/release/legal-pages.test.tsx`: рендер реквизитов и отсутствие фиктивных контактов.
- Эта карточка и `docs/audits/wp/WP-41_EVIDENCE.md`: scope и открытые гейты.

Статус полного WP-41: BLOCKED_ON_OWNER (юридическая редакция / R23 / retention).
Технический срез: PREPARED_FOR_REVIEW. Существующие тексты заменяются проектами для review;
страницы помечены как проекты и noindex. Не сливать и не публиковать до принятия текста.
Адрес пока не публикуется при отсутствии значения; это не юридическое освобождение от его указания.

- Дополнение по независимому review: `components/landing/footer.tsx` — убрать
  ссылку mailto на нейтральный placeholder, заменить на существующую /support.
  Иначе новый юридический раздел снова показывает фиктивный контакт через footer.

## 11.09.2026 — отдельный разрешённый consent/security срез

После вопроса «Разрешаешь реализацию серверной фиксации согласий в репозитории,
включая additive migration, локальные/disposable проверки, commit/push и PR —
без merge и production?» владелец ответил «da». Это разрешает перечисленные
работы; прежняя строка CONSENT_SECURITY/OWNER_GATE относится к истории #144.
Юридические проекты не становятся утверждёнными текстами вследствие этого ответа.

Ветка `wp/wp-41-consent-records`, зависимость — draft PR #144.
Резерв: S-MIG #7, timestamp `20260911090000`, DB4 #60. Конфликты проверяются
перед push; старые миграции неизменны. Additive SQL создаёт частный реестр
неизменяемых редакций, отдельную активацию, receipts и append-only withdrawals.
Записи утверждённых документов/активаций отсутствуют; runtime default-off.

Расширенный allowlist этого среза:
- `lib/legal/**`, `lib/i18n/ru.ts`, `.env.example`;
- `app/api/intake/{consent,start,submit,upload}/route.ts`, `app/i/[token]/**`;
- `proxy.ts`, `app/api/auth/{consent,register}/route.ts`,
  `app/auth/{callback,consent}/**`, `app/login/page.tsx`;
- новая migration выше; `tests/db4/60_consent_receipts.sql`,
  `tests/db4/run.zsh`, dedicated consent concurrency harness;
- `tests/auth/*consent*`, consent UI/route tests;
- `tests/ap1/environment/migration-ledger.sha256`,
  `tests/layout-studio/integration/integration.test.ts`: только новый migration pin;
- эта карточка и `docs/audits/wp/WP-41_CONSENT_EVIDENCE.md`.

Merge, запись в shared staging/production, env activation, утверждение
юридических текстов, retention/data-plane решений требуют отдельного разрешения.
Полный WP-41 не объявляется закрытым по итогам технического среза.
