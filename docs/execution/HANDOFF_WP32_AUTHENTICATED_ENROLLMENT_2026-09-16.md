# WP-32 authenticated enrollment — handoff

Дата фиксации: 2026-09-16, Asia/Tashkent
Репозиторий: `/private/tmp/archidom-wp32-ap6-run`
Ветка: `codex/wp32-ap6-run-cycle7`
База: `e992255d9e8419843b174926bedf85d93c9a9bd5`

## Цель

Завершить локальный disposable WP-32 без production/shared/Drive изменений:

`decision → approval → baseline → release → distribution → acknowledgement → change → impact review → photo review → milestone acceptance`.

Для внешнего Tashkent package требуется authenticated enrollment:

`organization → project → package → scoped memberships`.

## Что уже сделано

- Kora executor переведён с DB3/DB4/DB5 business fixture seeds на authenticated M2→M3 chain.
- Добавлена migration `supabase/migrations/20260916132722_projectceo_authenticated_package_enrollment.sql`.
- Новый RPC `projectceo_api.enroll_organization_project_scope`:
  - требует authenticated request actor через `project_intelligence._request_user_id()`;
  - вызывает базовый owner enrollment;
  - создаёт root/package scope;
  - создаёт project/package memberships и role capabilities;
  - использует idempotency и state revision;
  - запрещает неявную замену роли участника.
- Tashkent bootstrap больше не пишет privileged SQL в organization/package/membership/graph business tables. SQL оставлен только для disposable `public.designers`/`public.projects` identity bootstrap.
- Kora decision, approval, baseline, release, milestone и guest grant используют server-derived authenticated bindings.
- Реальное фото Kora: `/Users/msnigmatullaeva/Downloads/daf4912f-0cd1-4af7-93aa-981b607e1b8d.JPG`.
- Allowlist содержит одобренный Kora producer SHA:
  `sha256:4ecc11ef1563f3cd61f035147e5b4b2da0295059f06302a42a2c91e09263e500`.

## Проверки

- `223/223` test files PASS.
- `1877/1877` tests PASS.
- Auth/environment/layout targeted checks `30/30` PASS.
- Typecheck PASS.
- Lint: `0` errors, `13` pre-existing warnings.
- Production build PASS.
- `git diff --check` PASS.

## Текущий blocker

Это не blocker по коду и не отсутствие пользовательского доступа.

Disposable Colima profile `archidom-ap1-disposable` стал `Broken`. Hostagent запускает VZ/Ubuntu, но Colima теряет runtime state и сообщает противоречиво:

`already running` → `not running`.

Профиль уже удалён через disposable-only dispose. Production/shared profiles не изменялись.

## Как восстановить runtime

В новом чате сначала проверить host:

```zsh
colima list
limactl list
```

Если default и disposable снова `Broken`, сначала перезапустить Colima/Docker host или Mac. «Исправный профиль» не нужно искать: disposable профиль создаётся заново.

После восстановления выполнить только disposable flow:

```zsh
cd /private/tmp/archidom-wp32-ap6-run
colima start --profile archidom-ap1-disposable \
  --activate=false --save-config=false --ssh-config=false \
  --mount /private/tmp/archidom-wp32-ap6-run:w

AP1_KORA_SITE_PHOTO=/Users/msnigmatullaeva/Downloads/daf4912f-0cd1-4af7-93aa-981b607e1b8d.JPG \
SUPABASE_TELEMETRY_DISABLED=1 \
AP1_SUPABASE_BIN=/Users/msnigmatullaeva/.local/bin/supabase \
ARCHIDOM_PILOT_EVIDENCE_OUT=/private/tmp/wp32-tashkent-runtime-20260916 \
gtimeout 1200s zsh tests/pilot-evidence/run-m2-pilot-evidence.zsh
```

После любого исхода проверить, что disposable профиль остановлен. При ошибке сохранить только sanitized marker/error; cookies, JWT, session files и `.env` не публиковать.

## Не делать

- Не возвращать DB3/DB4/DB5 business seeds в Kora.
- Не добавлять privileged SQL для Tashkent organization/package/membership/graph data.
- Не использовать service role для human operations.
- Не менять production/shared/Drive/Pejeng.
- Не делать commit/push/draft PR до clean runtime PASS и финального независимого review.

## Следующий шаг нового чата

Проверить и восстановить Colima/VZ host, затем выполнить команду runtime выше. Если migration упадёт, зафиксировать точный sanitized Postgres error и исправить только его; после PASS обновить `docs/audits/wp/WP-32_EVIDENCE.md`, выполнить независимый review и подготовить commit/push/draft PR.
