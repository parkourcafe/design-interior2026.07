# WP-13 — Production-adoption operator script — EVIDENCE

Дата: 2026-09-11. Ветка: `wp/wp-13-adopt-production-script`. Implementation
HEAD: `f72e2cf`. Exact PR HEAD будет указан в PR после push; PR: `PENDING`.

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

## Локальные гейты

[ИЗВЛЕЧЕНО] `zsh -n tests/ap1/environment/adopt-production.zsh`: exit 0.

[ИЗВЛЕЧЕНО] `vitest run tests/ap1/environment/adopt-production.contract.test.ts`:
6 tests passed.

[ИЗВЛЕЧЕНО] Disposable PostgreSQL 17 dry-run с adopted legacy `.sql.txt`,
23 legacy ledger rows и `AP1_APPROVAL_RECORD='Approval B: dry-run'` дошёл до
`AP1_ADOPTION_VERIFY_DB_OK` и завершился `AP1_ADOPTION_COMPLETE
modules_opened=false deployment_performed=false`.

## CI

[ИНТЕРПРЕТИРОВАНО] CI запускается после push на точном HEAD. До этого файла
нет CI receipt; локальный результат не заменяет CI.

## Не сделано / owner gate

[ИЗВЛЕЧЕНО] Fresh production snapshot, классификация drift, Approval A,
Approval B, target allowlist file, clone rehearsal на восстановленном backup,
shared DB, deployment и merge не выполнялись.

[ИНТЕРПРЕТИРОВАНО] Скрипт намеренно требует идентификатор Approval B и
однострочный allowlist-ref; без них он не открывает target connection.

## Безопасность

[ИЗВЛЕЧЕНО] Использовался только disposable Docker PostgreSQL с `--network
none`. Shared DB, production, credentials, paid cloud, deployment и feature
flags не использовались. В diff нет секретов.
