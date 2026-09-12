# WP-14 — legacy-adopted hardening — EVIDENCE

Дата: 2026-09-11. Ветка: `wp/wp-14-legacy-adopted-hardening`. Implementation
commit: `ea0d48307e3eea5497e79abf1e73e5b00cec7952`. PR: `PENDING`.

## Основание

[ИЗВЛЕЧЕНО] Карточка WP-14, трек 1.3 / 0.10, требует S-MIG #2: deny-policy
для `public.rate_limits`, отзыв legacy SECURITY DEFINER RPC у `anon` и
`FORCE ROW LEVEL SECURITY` для `public.project_facts`.

[ИЗВЛЕЧЕНО] Решение владельца: «Р7 принимаю по рекомендации». Объём: deny
policy для `rate_limits`; 11 legacy SECURITY DEFINER RPC закрываются для
`anon`, доступ `authenticated` сохраняется; `is_studio_member` не меняется.

[ИЗВЛЕЧЕНО] Отдельное разрешение владельца: «Разрешаю WP-14 записать
persistent additive repository migration
`20260911110000_legacy_adopted_hardening.sql`, изменяющую RLS и EXECUTE
privileges, выполнить локальные DB4/DB5, commit, push и открыть draft PR.
Shared DB, production, deploy и merge не разрешаю.»

## Allowlist по факту

[ИЗВЛЕЧЕНО] Изменены только файлы карточки WP-14:

```text
supabase/migrations/20260911110000_legacy_adopted_hardening.sql
tests/ap1/environment/migration-ledger.sha256
tests/layout-studio/integration/integration.test.ts
tests/db4/run.zsh
tests/db4/57_legacy_adopted_hardening.sql
docs/audits/wp/WP-14_EVIDENCE.md
```

## Хотспоты

[ИЗВЛЕЧЕНО] H1 затронут только регенерацией immutable migration ledger и
добавлением новой migration в `preExisting`; H2 — добавлением DB4-57 в
существующий runner. H3–H18, CI и runtime-код не менялись.

## Пины

| пин | было | стало | основание |
|---|---:|---:|---|
| migration ledger | 93 | 94 | S-MIG #2, новая additive migration |
| DB4 runner | без DB4-57 | DB4-57 | WP-14 acceptance contract |

## Миграция

| timestamp | ledger SHA-256 | DB4/DB5 | S-MIG |
|---|---|---|---|
| `20260911110000` | `e9dcc62549fea88a8c75f9149b4fab3f4c9288b75d3bd91a28e15ab8d2dda63b` | DB4-57; full DB5 replay | #2 |

[ИЗВЛЕЧЕНО] Функция применяет изменения только при наличии legacy object:
clean bootstrap не содержит `public.rate_limits`, `public.project_facts` или
11 именованных RPC. Для совпавших SECURITY DEFINER overloads `PUBLIC` и
`anon` лишаются EXECUTE, а `authenticated` получает явный EXECUTE: это
необходимо, потому что один только revoke у `anon` не отменяет стандартный
grant `PUBLIC`. `is_studio_member` не входит в selector.

## Локальные гейты

[ИЗВЛЕЧЕНО] Node `v22.23.0`, npm `10.9.8`.

[ИЗВЛЕЧЕНО] Первичная команда с глобальным npm cache завершилась `EPERM` из-за
root-owned `~/.npm`; кода и lockfile она не меняла. Повтор с disposable cache
`/private/tmp/npm-cache-wp14` прошёл: lint — 0 errors, 13 existing warnings;
typecheck — PASS; Vitest — 205 files, 1642 passed, 10 skipped; build — PASS.

[ИЗВЛЕЧЕНО] `PI_DB_IMAGE=postgres:16-alpine zsh tests/db4/run.zsh` и
`postgres:17-alpine` — PASS, включая `DB4_LEGACY_ADOPTED_HARDENING_OK`.

[ИЗВЛЕЧЕНО] `PI_DB_IMAGE=postgres:16-alpine zsh tests/db5/run.zsh` и
`postgres:17-alpine` — PASS (`DB5_EXECUTION_HARNESS_OK`).

[ИЗВЛЕЧЕНО] `git diff --check` — PASS. Targeted ledger/layout contract tests
are included in the full Vitest result.

## CI

[ИНТЕРПРЕТИРОВАНО] CI receipt появится только после push на final commit; local
and disposable results не заменяют CI/AP5.

## Grep-проверки

[ИЗВЛЕЧЕНО] Поиск всех 11 имён legacy RPC в tracked repository не нашёл их
определений в clean schema; они задокументированы как observed legacy-runtime
objects. Поэтому migration использует `to_regclass` и catalog resolution плюс
`to_regprocedure`, а DB4-57 создаёт disposable SECURITY DEFINER stubs для
проверки ACL.

## Не сделано / вынесено

[ИЗВЛЕЧЕНО] Shared DB, production, deployment, merge, audit вызовов
`authenticated`, SMTP/leaked-password setting и `market_harvest` не
исполнялись и не входят в WP-14.

## Blind review

[ИЗВЛЕЧЕНО] Independent read-only security review exact implementation SHA
`ea0d48307e3eea5497e79abf1e73e5b00cec7952`: PASS, no findings. Проверены
allowlist, ledger 93→94, no-op clean bootstrap, restrictive deny-policy,
эффективный anon denial с сохранением `authenticated`, неизменность
`is_studio_member`, RLS и закрытый helper ACL. Перед push повторно сверяется
final evidence SHA.

## Безопасность

[ИЗВЛЕЧЕНО] Использовались только repository files и disposable Docker
PostgreSQL. Секреты и env files не читались; shared DB и production не
использовались.
