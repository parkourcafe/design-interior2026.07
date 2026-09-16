# WP-31 — AP6-инструменты — EVIDENCE

Дата: 2026-09-16, среда. Начало финального локального прохода: 07:44 +05. Ветка: `codex/wp31-ap6-tooling-closure`. База: `origin/main` (`c683f166`). PR: draft создаётся после публикации ветки. Режим: repository-only, allowlist approved.

## Основание

[ИЗВЛЕЧЕНО] WP-31 отделён от WP-32: этот пакет стабилизирует загрузчик, пяти-ролевые session bindings, proof contracts и исполняемые bytes. AP6 runtime, disposable execution и runtime receipt остаются WP-32.

[ИЗВЛЕЧЕНО] Решение владельца в текущем диалоге: закончить WP-31 локально без изменения allowlist; заменить fabricated proofs реальными query/result/audit bindings; убрать privileged SQL для M2 business/package content, оставив только disposable identity/scope bootstrap; зафиксировать server-side provenance фактической auth session; провести независимый Codex security review; только после стабилизации bytes отдельно запросить approval на точные SHA-256.

## Allowlist по факту

[ВЕРИФИЦИРОВАНО] Владелец отдельно подтвердил финальные SHA дословной фразой: «Одобряю SHA cdc0cceb… и 495c121f…». `tests/pilot-evidence/executors/allowlist.json` содержит именно эти полные значения; детерминированная проверка подтверждает их совпадение с текущими bytes.

[ИНТЕРПРЕТИРОВАНО] Для закрытия security findings оркестратор расширил исходную карточку WP-31 на минимальные request-context/API файлы, которые формируют server-validated session provenance. Миграций, production-конфигурации и runtime-данных нет.

## Реализованные bindings

- [ВЕРИФИЦИРОВАНО] `audit` и `replay` несут точный упорядоченный набор реальных audit event IDs из command/audit rows; `authenticatedRead`, `privacy` и `tenancy` явно несут пустой audit-ID set вместо выдуманных связей.
- [ВЕРИФИЦИРОВАНО] Каждый proof содержит scope, manifest digest, challenge nonce, ordered command IDs, canonical result digest и санитизированный source; builder и finalizer независимо пересчитывают и проверяют bindings.
- [ВЕРИФИЦИРОВАНО] Privacy proof связан со всеми пятью request IDs, tenancy proof — с guest empty-portfolio response, replay proof — с direct replay results и единственным atomic side effect.
- [ВЕРИФИЦИРОВАНО] Manifest читается executor один раз в memory snapshot; digest считается по этому snapshot, а все последующие payload decisions используют только snapshot. Executor bytes и manifest pin выполняются из отдельного private `mktemp` directory.
- [ВЕРИФИЦИРОВАНО] Прямые privileged inserts M2 revisions, variants, review, approval, handoff и graph content удалены. Оставшийся SQL создаёт только disposable project/organization/package scope, memberships, capabilities и workflow, необходимые до authenticated command door.
- [ВЕРИФИЦИРОВАНО] `getClaims()` требует UUID `session_id`; наружу возвращается только `sha256(session_id)` в private/no-store header. Runner связывает этот server digest с cookie session, точной строкой `auth.sessions`, всеми пятью read requests и каждой owner/client command/replay. Raw JWT и bearer token в receipt не попадают.

## Пины

| пин | прежний allowlist | финальный SHA-256 | статус |
|---|---|---|---|
| `tests/pilot-evidence/run-m2-pilot-evidence.zsh` | `sha256:96953048e39f67de16824b53590b24095c54ecf3cb505b0273c4db32001afa8e` | `sha256:cdc0cceb66b55fc4ca0f0deca1a638597d74bb8f5e36e89d11f791539d587a35` | OWNER_APPROVED / MATCH |
| `tests/pilot-evidence/executors/external-package-runner.zsh` | `sha256:1bf1f3345d9d2f00e75ef962cd6c954141f786fd0eabddaaf56668451660d870` | `sha256:495c121f6a8519eb28110b3abfc7240c6c5fffdfaf416a74e9cf9bf50310f084` | OWNER_APPROVED / MATCH |

## Миграция

Нет. Схема и timestamped migrations не изменялись.

## Локальные гейты после allowlist approval

- [ВЕРИФИЦИРОВАНО] Targeted security/session/proof suites: 6 files, 61/61 tests passed; final byte-exact/teardown check: 21/21.
- [ВЕРИФИЦИРОВАНО] Первый post-approval `npm run test` выявил только известный ClamAV process timing flake: 215/216 files, 1768/1769 tests. Изолированный retry: 15/15 PASS. Полный retry: 216/216 files, 1769/1769 tests PASS. Scanner source и tests не менялись.
- [ВЕРИФИЦИРОВАНО] `npm run lint`: 0 errors, 13 существующих warnings.
- [ВЕРИФИЦИРОВАНО] `npm run typecheck`: PASS.
- [ВЕРИФИЦИРОВАНО] `zsh -n` обоих executors: PASS.
- [ВЕРИФИЦИРОВАНО] `git diff --check origin/main`: PASS.
- [ВЕРИФИЦИРОВАНО] `npm run build` через Turbopack не стартует в этом worktree, потому что `node_modules` — symlink за filesystem root. Эквивалентный `next build --webpack`: PASS, TypeScript PASS, 46 static pages.

## CI

До публикации ветки не запускался. Draft PR создаётся после push; exact-head CI фиксируется отдельно и не заменяет runtime WP-32.

## Blind review

| reviewer | дата | вердикт | закрытие |
|---|---|---|---|
| independent Codex security review | 2026-09-16 | первоначально FINDINGS | Закрыты fabricated audit bindings, manifest TOCTOU и cookie-only session provenance. |
| independent Codex security re-review | 2026-09-16 | PASS, no P0-P3 | Подтверждены exact audit/source bindings, memory snapshot, server-side session digest и отсутствие token leak. Publication оставлен HOLD только из-за stale allowlist. |
| independent Codex final byte review | 2026-09-16 | PASS | Подтверждено, что wrapper `cdc0cceb…` дополнительно блокирует inherited origin/container/cookie/port/Docker overrides и не даёт регрессии. |

## Не сделано / вынесено

- AP6 Docker/Supabase/runtime execution, реальные данные, receipt и hosted acceptance не запускались; это WP-32.
- R1-08A coordinate convention не менялась и не блокирует WP-31.
- Merge, AP6 runtime, production/shared DB и deployment остаются отдельными gates.
- Переданный владельцем Drive-пример реального процесса не открывался и не использовался в WP-31; это отдельный вход для последующего продуктового/runtime пакета.

## Безопасность

[ВЕРИФИЦИРОВАНО] Production, shared Supabase, Docker AP6 runtime, сеть, реальные partner data и платные вызовы не использовались. Секреты и raw tokens не читались и не выводились. Runtime PASS не заявляется.
