# WP-13 — Production-adoption operator script — EVIDENCE

Дата: 2026-09-20 (исходная фиксация — 2026-09-11). Ветка:
`wp/wp-13-safe-control`. PR: #157, заменяет #151.

Статус: `SCOPE_REDUCED_TO_DISPOSABLE`.

[ИНТЕРПРЕТИРОВАНО] Блокер снят не исправлением трёх находок по отдельности, а
вторым вариантом самого блокера — `scope reduction to clone-only`. Способности
выполнить adoption против shared DB в репозитории больше нет, поэтому находки
1–3 относятся к удалённому режиму. Ниже история блокера сохранена как есть, а
раздел «Снятие блокера» описывает, что именно изменилось и как это проверялось.

## Основание

[ИЗВЛЕЧЕНО] WP-13, трек 1.3, требует отдельную Approval A history-repair
операцию, затем скрипт Approval B: проверить уже принятую baseline-запись,
применить роли и additive-цепочку из ledger с проверкой SHA-256, выполнить
`verify-db.sql` и role precondition.

[ИЗВЛЕЧЕНО] Решения владельца: «Р7 принимаю по рекомендации», «Р20 выбираю
вариант (а)», «Р22 — платный M1→M2 цикл для дизайнера». Они зафиксированы как
контекст программы; этот пакет не открывает security hardening, HTTP enroll
или коммерческий цикл.

## Allowlist по факту

[ИЗВЛЕЧЕНО] Изменены только файлы карточки WP-13:

```text
reconciliation-2026-09/baseline-adoption.sql
tests/ap1/environment/adopt-production.zsh
tests/ap1/environment/adopt-production.contract.test.ts
docs/audits/wp/WP-13_EVIDENCE.md
```

## Хотспоты

[ИЗВЛЕЧЕНО] `bootstrap-disposable.zsh`, миграции, migration ledger, CI и
production configuration не менялись. Скрипт запускает только существующие
`roles.sql`, additive migrations, `verify-db.sql` и role precondition.

## Пины

| пин | было | стало | основание |
|---|---|---|---|
| baseline version | отсутствовал операторский guard | ровно `20260716071024` обязана уже присутствовать | WP-13, historical adoption без baseline DDL |
| baseline ledger rows | отсутствовал | `23` только для disposable rehearsal | WP-13 и текущий сценарий reconciliation |

## Миграция

Нет новой migration и S-MIG. `baseline-adoption.sql` не исполняет DDL: после
fresh snapshot assertion он в отдельной транзакции добавляет только
`20260716071024` в существующий ledger Approval A.

## Локальные гейты (история, HEAD `0e8924e` — заменён)

Всё ниже до раздела «Снятие блокера» описывает исходный пакет #151 на коммите
`0e8924ebfe17ca074cd7b7f952a472a081574b1c` и сохранено как история. Текущее
состояние кода — в разделе «Снятие блокера».

[ИЗВЛЕЧЕНО] `zsh -n tests/ap1/environment/adopt-production.zsh`: exit 0.

[ИЗВЛЕЧЕНО] `vitest run tests/ap1/environment/adopt-production.contract.test.ts`:
6 tests passed.

[ИЗВЛЕЧЕНО] Disposable PostgreSQL 17 dry-run с adopted legacy `.sql.txt`,
23 legacy ledger rows и `AP1_APPROVAL_RECORD='Approval B: dry-run'` дошёл до
`AP1_ADOPTION_VERIFY_DB_OK` и завершился `AP1_ADOPTION_COMPLETE
modules_opened=false deployment_performed=false`.

[ИНТЕРПРЕТИРОВАНО] Эти проверки подтверждают только локальную исполнимость
текущего кода. Они не доказывают, что Approval B, allowlist target или snapshot
безопасно и проверяемо привязаны к shared DB.

## CI

[ИЗВЛЕЧЕНО] На `0e8924ebfe17ca074cd7b7f952a472a081574b1c` CI run
`34564069559`: change scope, gates, DB4 (PG16/17), DB5 (PG16/17) и cycle 7
completed `SUCCESS`; AP5 оставался `IN_PROGRESS` на момент фиксации этого
receipt. Claude review run `34564069633` completed `SUCCESS`.

[ИНТЕРПРЕТИРОВАНО] Зелёные или ожидающие CI jobs не снимают блокер security
design ниже и не являются разрешением merge или какого-либо target execution.

## Independent review

[ИЗВЛЕЧЕНО] Независимый review на
`0e8924ebfe17ca074cd7b7f952a472a081574b1c` дал вердикт `BLOCKER`:

1. `AP1_APPROVAL_RECORD` проверяется как произвольный текст с префиксом
   `Approval B:`, без проверяемой привязки к decision artifact.
2. Однострочный allowlist file предоставляется вызывающим; в режиме `prod`
   это не доказывает привязку выбранного target к безопасному endpoint и может
   направить запуск на shared DB.
3. Snapshot counts передаются вызывающим и не связаны с immutable snapshot
   hash/time или классификацией drift.

[ИНТЕРПРЕТИРОВАНО] Это security-design проблема. Её нельзя устранять заменой
локальных проверок, дополнительным тестом или ослаблением refusal paths.

## Exact blocker (исходная формулировка)

`Owner-approved, verifiable approval artifact bound to target endpoint fingerprint, immutable git SHA/ledger hash, fresh snapshot hash/time and drift classification, or scope reduction to clone-only.`

## Снятие блокера

[ИЗВЛЕЧЕНО] Выбран второй вариант — `scope reduction to clone-only`. Изменения
в `tests/ap1/environment/adopt-production.zsh`:

1. Любой запуск без `--dry-run` завершается `AP1_ADOPTION_SHARED_TARGET_DISABLED`
   с кодом 69 — до чтения каких-либо реквизитов подключения.
2. `AP1_DB_URL` удалён из скрипта полностью: ни интерфейса, ни ветки исполнения
   против внешней БД не осталось. Единственный достижимый клиент — psql внутри
   одноразового Docker-контейнера с `--network none`.
3. `run_sql_file`, `run_sql` и `psql_value` больше не игнорируют ошибку psql:
   каждая падает с `AP1_ADOPTION_SQL_*_FAILED` (70) вместо продолжения.

[ИЗВЛЕЧЕНО] Проверено запуском на `main` + этой ветке (2026-09-20):

```
zsh -n tests/ap1/environment/adopt-production.zsh                 → exit 0
AP1_APPROVAL_RECORD='Approval B: test' zsh …/adopt-production.zsh \
  --target-ref some-shared-target --allowlist-ref <файл>
  → AP1_ADOPTION_SHARED_TARGET_DISABLED, exit 69
vitest run tests/ap1/environment/adopt-production.contract.test.ts
  → 7 passed | 1 skipped
```

[ИЗВЛЕЧЕНО] Контрактный тест «refuses every non-disposable target before
reading its connection details» передаёт фиктивный `AP1_DB_URL` и проверяет,
что в stderr нет подстроки `fixture` — то есть отказ происходит до чтения URL.

[ИЗВЛЕЧЕНО] Пропущенный тест — `describe.skipIf(!zshAvailable || !dockerAvailable)`
(«disposable execution failures»). Docker в среде проверки не стартует, поэтому
этот блок **не запускался**. Формулировка «должен работать» к нему не применима.

[ИНТЕРПРЕТИРОВАНО] Эти проверки подтверждают отказ от shared-target режима и
локальную исполнимость. Они не подтверждают корректность самого rehearsal на
восстановленном backup — этот путь требует Docker и прогоняется отдельно.

## Не сделано / owner gate

[ИЗВЛЕЧЕНО] Fresh production snapshot, классификация drift, Approval A,
Approval B, clone rehearsal на восстановленном backup, shared DB и deployment
не выполнялись. DB4/DB5 и AP5 на этой ветке не запускались.

[ИЗВЛЕЧЕНО] Скрипт в текущем виде не способен изменить shared DB или
production: соответствующий режим удалён, а не отключён флагом.

## Безопасность

[ИЗВЛЕЧЕНО] Использовался только disposable Docker PostgreSQL с `--network
none`. Shared DB, production, credentials, paid cloud, deployment и feature
flags не использовались. В diff нет секретов.
