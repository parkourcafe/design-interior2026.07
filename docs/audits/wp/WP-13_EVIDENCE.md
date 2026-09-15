# WP-13 — Production-adoption operator script — EVIDENCE

Дата: 2026-09-11. Ветка: `wp/wp-13-adopt-production-script`. PR HEAD:
`0e8924ebfe17ca074cd7b7f952a472a081574b1c`. PR: #151.

Статус: `BLOCKED_SECURITY_DESIGN`.

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

## Не сделано / owner gate

[ИЗВЛЕЧЕНО] Fresh production snapshot, классификация drift, Approval A,
Approval B, target allowlist file, clone rehearsal на восстановленном backup,
shared DB, deployment и merge не выполнялись.

[ИЗВЛЕЧЕНО] Текущий пакет не должен быть merged, пока владелец не выберет
одно из условий, сформулированных в блокере ниже.

## Exact blocker

`Owner-approved, verifiable approval artifact bound to target endpoint fingerprint, immutable git SHA/ledger hash, fresh snapshot hash/time and drift classification, or scope reduction to clone-only.`

## Безопасность

[ИЗВЛЕЧЕНО] Использовался только disposable Docker PostgreSQL с `--network
none`. Shared DB, production, credentials, paid cloud, deployment и feature
flags не использовались. В diff нет секретов.
