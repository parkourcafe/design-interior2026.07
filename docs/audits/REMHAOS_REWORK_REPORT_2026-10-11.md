# Доработки после промежуточной приёмки — отчёт (11.10.2026)

База: HEAD `bf705ae` (detached), рабочее дерево без коммитов. Итоговый снимок **06-p1**
(доработки RW-1…RW-4 + исправление P-1): `manifest_id
2a1fc4e5b544f3929e134a944f86c5474b2929c1d8efe2203d97e72c72779223`, 52 файла,
`RESTORE_CHECK_OK`. Коммитов, push, PR и изменений production — нет.

Обязательные проверки на байтах снимка 06 (`logs/p1/summary.txt`):
`lint 0 · typecheck 0 · test 0 (2545/2545) · build 0 · DB4 PG16 0 · DB4 PG17 0 ·
AP5 31/31 без пропусков`. Примечание: первый запуск `test` в цепочке дал 3 падения
(`legacy-host-redirect`, `execution-guardrail`, `documentation/feature-flag`) —
причина не в коде, а в утечке переменных окружения AP5 (`NEXT_PUBLIC_APP_URL`,
`REMHAOS_*_ENABLED`) из моего скрипта цепочки в шаг тестов; повтор в чистом
окружении — `286 файлов / 2545 тестов` зелёные (`logs/p1/test-clean-env.log`).
Предыдущий снимок 05-rework (`dd3ea08a…`, до P-1) сохранён для сравнения.

## 1. Уточнения клиента — авторизация на сервере (решение, п. 3)

- Миграция `20261011100000_m1_legacy_read_clarifications_authority.sql` (additive, тело `get_m1_legacy_project_read` заменено): `passport.clarifications` отдаётся только если `projectceo_platform._passport_approval_authority(org, project, user) in ('owner','delegated_architect')` — проверка при каждом чтении, механизм DEC-041 §3; флаг `clarificationsVisible` строго boolean (`coalesce(…, false)`). Доступ дизайнера (owner_lead) сохранён.
- Приложение (`m1-legacy-read.ts`, `live-read-port.ts`, `m1-passport-panel.tsx`, `ru.ts`) показывает уточнения только по серверному флагу; клиентской фильтрации больше нет.
- Проверки: `tests/db4/97_m1_clarifications_authority.sql` — владелец видит; архитектор без права — не видит; grant → видит; другой архитектор — нет; revoke → нет; неактивный член/клиент/строитель/чужая организация/чужой проект — отказ RPC; паспорт без уточнений — ключа нет, флаг true. DB4 PG16/PG17 — зелёные (`db4-pg16.log`, `db4-pg17.log`). Браузер + RPC: `rw1-clarifications.mjs` 12/12 (`rw1-browser.log`).
- Контакты/бюджет — не менялись; полный разбор (кто получает через Data API, на каком основании, соответствие утверждённым правам) — `CONTACTS_BUDGET_RPC_EXPOSURE_2026-10-11.md` (заменяет раннюю заметку `FINDING_contacts_budget_m1_read.md`).

## 2. AP5 — причина, исправление P-1, полный прогон (решение, п. 2; решение 11.10 — вариант P-1, без P-2)

Подробно: `RW2_AP5_DIAGNOSIS.md` (§7 — актуализация после P-1). Кратко:

- **Исправление прежнего объяснения.** Ранее отказ шага 15 объяснялся «30-секундным тайм-аутом» двери публикации. Это неверно: с 28.09.2026 у двери `projectceo_product_api.publish_baseline_atomic` никакого function-level лимита не было, и действовал **ролевой предел 8 секунд** (`rolconfig` платформенных ролей: `authenticator` и `authenticated` — `statement_timeout=8s`, `anon` — `3s`; глобальный `statement_timeout=0`). Отказ наступал через ~8,7 с от посева фикстуры, а не через 30 с.
- **История подтверждена по миграциям и воспроизведена в чистом Postgres 17** (`p1-history-replay-postgres-17-alpine.log`, применение всех миграций по порядку с опросом `pg_proc.proconfig` после каждой значимой):
  `20260825030000` (дверь создана) → `{search_path="", statement_timeout=30s}`; `20260911160000` → то же; `20260925100000` (7-аргументная сигнатура) → то же; **`20260928090000`** (`create or replace function … set search_path=''`) → `{search_path=""}` — запись `statement_timeout=30s` исчезла, потому что `create or replace` записывает proconfig целиком по определению, а guard той миграции проверял владельца, но не proconfig; `20260928091000`, `20261011100000` → без изменений; **`20261011110000` (P-1)** → `{search_path="", statement_timeout=30s}`.
- **Состояние живой БД** (стенд, 157 миграций, до исправления): `proconfig={search_path=""}`, owner `pi_table_owner`, definer, ACL `{pi_table_owner=X/pi_table_owner}`; роли — `authenticated 8s`, `authenticator 8s + lock_timeout 8s`, `anon 3s` (`p1-door-before.txt`, `p1-role-limits.txt`). После применения миграции: `proconfig={search_path="", statement_timeout=30s}`, владелец, definer и ACL те же, `ROLE_LIMITS_UNCHANGED`, повторное применение — без ошибок (`p1-door-after.txt`, `p1-role-limits-after.txt`, `p1-stand-apply.log`).
- **Исправление — одна additive-миграция `20261011110000_projectceo_publish_baseline_door_timeout.sql`**: `alter function … set statement_timeout = '30s'` — ровно то, что ставили 20260825/0911/0925. Guard в той же транзакции снимает свойства двери до `alter` и сравнивает после: владелец, `security definer`, ACL, язык, волатильность, типы, тело, остальной proconfig (`search_path`), глобальный `statement_timeout` и `rolconfig` ролей `authenticator/authenticated/anon/service_role` — любое отличие = откат. Глобальные, ролевые и тестовые лимиты не менялись; тест AP5 и его пороги не трогались.
- **Проверки настройки добавлены в двух местах:** (1) `tests/db4/98_publish_baseline_door_shape.sql` — форма двери (владелец, definer, `search_path`, `statement_timeout=30s`, ровно две записи proconfig, делегирование во внутреннюю функцию, права: закрыта всем, кроме `authenticated` после выключателя M3; внутренняя недостижима), добавлен в список `tests/db4/run.zsh`; негативный контроль на стенде — после `reset statement_timeout` падает `DB4_PUBLISH_BASELINE_DOOR_TIMEOUT_NOT_PINNED`; (2) `tests/ap1/environment/verify-db.sql` — pre-flight AP5 на реальном стеке теперь требует `statement_timeout=30s` у обеих дверей публикации (`publish_version`, `publish_baseline_atomic`), иначе `AP1_PUBLICATION_DOOR_TIMEOUT_NOT_PINNED`; негативный контроль на стенде — срабатывает (`p1-verify-db-on-stand.log`). В DB4 действие лимита проверить нельзя (таймер statement_timeout не перевзводится внутри идущего statement) — это сказано в тесте; действие доказывает только HTTP-путь.
- **Полный AP5 на итоговых байтах рабочего дерева через настоящий HTTP/Auth-путь** (одноразовый стек по рецепту CI, PostgREST + GoTrue, 158 миграций, один worker, хост без нагрузки): pre-flight `AP1_DB_OK … publication_door_timeouts=ok`; **31 passed / 0 failed / 0 skipped / 0 flaky**, `assert-no-skips` exit 0; шаг 15 `blocked_result_limit` — пройден (24,0 с), шаг 16 — пройден в составе матрицы, не искусственно. Вызовов двери через PostgREST — 4, самый долгий **11,5 с** (> 8 с ролевых, < 30 с), в журнале базы и приложения `57014` — 0 (`logs/p1/ap5/`). Это прогон на рабочем дереве, а не на экспериментальной копии.
- **Что не делалось:** P-2 (политика членства без per-row вызова) — по решению владельца не выполняется; остаётся как наблюдение: 69 % стоимости публикации уходит в RLS-политику, запас до 30 с — ~18 с на графе AP5.

## 3. Резервные копии (решение, п. 1)

- `deploy/self-hosted/backup.sh`: при старте контейнера сначала копия (роли, база `-Fc`, файлы) с проверкой (`CREATE ROLE`, `PGDMP`, `pg_restore --list` и полное чтение `pg_restore -f /dev/null`, `gzip -t`, `tar -t`, маркер `verified-<штамп>.ok`), потом уборка по сроку. Отказ → частичные файлы удалены, `BACKUP_FAILED … резервное копирование не выполнено`, код 70, повтор не чаще `BACKUP_RETRY_SECONDS` (≥ 60, по умолчанию 900). Нет пригодной копии → `BACKUP_CRITICAL`, код 71. Просроченные копии удаляются и при отказе; срок T=14 сут и порог T−Δ=13 сут не менялись; исключений нет. Состояние — `backups/backup-status`.
- Тесты: `tests/release/backup-start.test.ts` (8) + `backup-retention.test.ts` (5) на подменах команд; настоящие бинарники — `rw3-real-proof.log`: успех (`BACKUP_OK`, дамп читается `pg_restore`, роль и файл в копии), отказ при живой копии (70), отказ без копии (71), просроченная копия удалена при отказе, `threshold=1123200s limit=1209600s`.
- README `deploy/self-hosted` обновлён.

## 4. Перенос аккаунтов — NULL в token-полях (решение, п. 4)

- `scripts/cutover/transfer.zsh`: список из 8 полей (`confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, phone_change, phone_change_token, reauthentication_token`), подтверждённых схемой GoTrue v2.192.0 и его поведением (`gotrue-token-columns.txt`); приёмник проверяется по каждому полю (`character/YES`), иначе ОТКАЗ до выгрузки; NULL → `''` только для списка, непустые значения не тронуты; источник только читается; в отчёте — имена полей и количества без значений.
- Репетиция (`rw4/rehearsal.log`, стенд, синтетика): **без нормализации** вход паролем → GoTrue `500 Database error querying schema` (`gotrue-null-scan.txt`: `converting NULL to string is unsupported`); перенос → `TOKEN_NORMALIZED` по полям (2/1/2/2/2/2/2/2 — одно непустое значение сохранено), сверка OK, 8 таблиц; после переноса **вход паролем 200 ×2, неверный пароль 400, вход кодом из письма 200** (локальный smtp-sink); повторный перенос отклонён (приёмник не пуст); источник не изменён.

## 5. Почта

Все проверки писем — через локальный SMTP-перехватчик стенда. **Внешняя доставка, SPF/DKIM/DMARC и репутация отправителя не проверены** и в этой среде проверены быть не могут.

## 6. Пакет для независимой проверки

`package-06-p1.tar.gz` (SHA-256 — в `package-06-p1.tar.gz.sha256` и в сообщении
владельцу): `full.diff` (binary diff к `bf705ae`), `new-files/` (неотслеживаемые
исходники), `manifest.sha256` + `manifest-id.txt` снимка 06, `status.txt`,
`diff-stat.txt`, три отчёта (этот, `RW2_AP5_DIAGNOSIS.md`,
`CONTACTS_BUDGET_RPC_EXPOSURE_2026-10-11.md`), логи: `logs/p1/` (DB4 PG16/17,
AP5 — `run.log`, `report.json`, `verify-db.log`, `door-state.txt`, `door-pgss.txt`,
гейты, `test-clean-env.log`), `logs/rw/` (RW-1…RW-4, история лимита, стенд
до/после, негативные контроли), `logs/ap5-base-before-p1/` (отказ исходного
снимка для сравнения), скрипты прогонов. Ключи локальных стеков, JWT, пароли
тестовых аккаунтов и строки подключения замаскированы; проверено сканом.

## 7. Что осталось открытым

1. **Контакты и бюджет** — нарушений утверждённых прав не найдено; два решения
   за владельцем (`CONTACTS_BUDGET_RPC_EXPOSURE_2026-10-11.md` §5): состав
   полей паспорта для архитектора проекта; `budget.risk_level` в сводке для
   подрядчика (в данных, не на экране) против формулировки решения 01.10
   «без бюджета».
2. **SPF/DKIM и внешняя доставка почты** — вне стенда, не проверялись.
3. **Вход перенесённых аккаунтов** проверен на уровне GoTrue API (паролем и
   кодом), не через страницу `/login` — UI-путь тот же, что в MAIL-01.
4. **P-2** (политика членства без per-row вызова) по решению владельца не
   выполняется; запас двери на графе AP5 — ~18 с до 30 с.
5. Hosted-БД не опрашивалась: все утверждения о состоянии БД — по локальному
   стенду и одноразовому стеку с теми же миграциями.
