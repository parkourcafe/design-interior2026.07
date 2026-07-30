# ArchiDom RU — AP1 Disposable Environment Report

Дата: 20 июля 2026 года.  
Контур: одноразовый локальный Supabase, только AP1.  
Production: не читался, не связывался и не изменялся.

```text
AP1_PROFILE=archidom-ap1
AP1_PROFILE_ISOLATED=true
AP1_VIRTUAL_DISK_GIB=100
AP1_REQUIRED_STACK=DB,Auth,Kong,PostgREST,Storage
AP1_EXCLUDED_SERVICES=imgproxy,mailpit
PRODUCTION_CHANGED=false
```

## Что подготовлено

- Supabase CLI зафиксирован на `2.109.1` и запускается с изолированными `HOME` и
  npm cache в `/private/tmp`.
- `supabase/config.toml` использует PostgreSQL 17 и отдельные порты
  `59620–59629`; project ref, remote URL и production credentials отсутствуют.
- Data API имеет точный allow-list: `public`, `projectceo_api`,
  `projectceo_read_api`, `projectceo_product_api`, `projectceo_m4_api`.
- Private schemas не входят в PostgREST exposure; новые objects не публикуются
  автоматически.
- Auth запрещает anonymous sign-in. Пять пользователей AP1 создаются только в
  disposable Auth и получают пять независимых сессий.
- Storage включён; `client-uploads` должен оставаться private. Image transforms
  не входят в AP1.
- Локальный mailbox UI исключён. Для тестовых ссылок используется
  `auth.admin.generateLink`; отправка email не нужна.
- Runtime verifier проверяет Auth health, Storage health, API allow-list,
  блокировку private schemas, отсутствие runtime grants в persistence schemas,
  NOLOGIN/NOINHERIT executor roles, PG17, private bucket и точный список
  применённых migrations.
- `supabase/roles.sql` idempotently materializes три cluster-level NOLOGIN role
  до migrations и даёт только migration executor право назначать ownership.
  Ни одна существующая timestamped migration не изменялась.

## Изоляция Docker

Создан отдельный Colima profile `archidom-ap1`. Его Docker daemon доступен только
через явный socket:

```text
unix:///Users/msnigmatullaeva/.colima/archidom-ap1/docker.sock
```

Фактический attached data disk проверен внутри VM: `/dev/vdb1`, около 99 GiB,
около 95 GiB свободно на момент подготовки. Глобальный Docker context возвращён
на `colima`. Default profile остаётся запущен; пять unrelated OtherBali
containers не останавливались и не изменялись.

Supabase CLI предупреждает, что forwarded development ports слушают все host
interfaces. Поэтому этот disposable stack не является production contour: в
нём нет production данных или секретов, URL harness принимает только loopback,
а после Kora E2E профиль должен быть остановлен. Это ограничение явно не
переносится в production-adoption plan.

Первая попытка с меньшим диском была остановлена после исчерпания физического
места и read-only remount. Повреждён был только disposable AP1 profile. Он был
удалён и пересоздан; default profile не очищался и не перезапускался.

## Секреты

- `PROJECTCEO_TOKEN_SECRET` — минимум 32 случайных байта.
- Значение создаётся только на время AP1 в процессе E2E, не печатается, не
  коммитится и никогда не получает префикс `NEXT_PUBLIC_`.
- Local anon/service keys читаются из `supabase status` только runtime harness.
  Они не сохраняются в repository evidence и не выводятся в отчёт.
- Service key используется test orchestrator только для создания disposable
  Auth users и удаляется из environment до запуска Next.js.
- Next.js запускается из временной source copy без любых env-файлов, через
  `env -i`, с изолированным `HOME` и только local anon URL/key, app URL и
  ephemeral token secret. Временная копия удаляется после E2E.
- Существующий `.env.local` не меняется, не копируется в AP1 runtime и его
  production values не выводятся.

## Команды gate

Все команды ниже выполняются из `repo`; для isolated profile используется
default socket из скриптов или явный `DOCKER_HOST`.

```sh
zsh tests/ap1/environment/run-local.zsh start
zsh tests/ap1/environment/run-local.zsh reset
zsh tests/ap1/environment/run-local.zsh restart
zsh tests/ap1/environment/run-local.zsh status
```

Выполненная последовательность:

1. read migration прошла PG16 и PG17 harness;
2. SHA-256 `f13fba09145de4960fc3b216664b060db37354d22e14216c6deb30d03b269837`
   независимо сверена и записана в ledger;
3. весь ledger применён в disposable Supabase;
4. runtime verifier пройден;
5. выполнены чистый reset и stop/start restart replay;
6. environment оставлен запущенным для five-session Kora E2E.

## Текущий gate status

Итог фактического AP1 environment gate:

```text
ENVIRONMENT_CONFIG_READY=true
ISOLATED_DOCKER_READY=true
SUPABASE_STACK_STARTED=true
POSTGRES_VERSION=17.6
MIGRATIONS_APPLIED=14
MIGRATION_LEDGER_EXACT=true
AUTH_HEALTH=true
STORAGE_HEALTH=true
ALLOWED_API_SCHEMAS=5
PRIVATE_SCHEMAS_BLOCKED=5
PRIVATE_PERSISTENCE_RUNTIME_GRANTS=0
EXECUTOR_ROLES_GUARDED=true
CLIENT_UPLOADS_BUCKET_PRIVATE=true
RESET_RESTART_PROOF=true
AP1_ENVIRONMENT_READY=true
PRODUCTION_CHANGED=false
```

Проверки repository side: environment contract `6/6 PASS`, TypeScript `PASS`,
shell syntax `PASS`, `git diff --check` `PASS` на момент environment handoff.
Сам environment gate не заменяет five-session authenticated Kora evidence.

## Проверенная документация

- [Supabase CLI local workflow](https://supabase.com/docs/guides/local-development/cli-workflows)
- [Supabase CLI configuration](https://supabase.com/docs/guides/local-development/cli/config)
- [Supabase CLI status/start reference](https://supabase.com/docs/reference/cli/supabase-status)
- [Supabase custom roles / roles.sql](https://supabase.com/docs/reference/cli/supabase-db-push)
- [Secure default: tables and functions are not auto-exposed](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically)
- [GoTrue health endpoint](https://supabase.com/docs/guides/troubleshooting/how-do-i-check-gotrueapi-version-of-a-supabase-project-lQAnOR)
