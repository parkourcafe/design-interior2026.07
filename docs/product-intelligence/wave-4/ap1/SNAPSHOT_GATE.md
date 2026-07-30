# ArchiDom RU — AP1 Snapshot Gate

Дата: 18 июля 2026 года.  
Стартовый commit: `9470fceb0912b5546d2d53b297a6a01c8c3d28a8`.  
Branch: `claude/arhidom-cinematic-website-t2zfdc`.  
Worktree на момент snapshot: clean.

```text
AP1_SCOPE=disposable_local_only
PRODUCTION_ENV_READ=false
PRODUCTION_WRITES=false
PRODUCTION_APPLIED=false
```

## Repository baseline

- 11 immutable timestamped migrations;
- последний accepted timestamp: `20260717103000`;
- local evidence commits: M2/M3 `9874524`, M4 `e74f4b3`, request-bound UI
  `a8c86a8`, Kora evidence `487e993`, readiness verdict `88b1442`;
- Charter v0.4 adoption: `9470fce`;
- последний release gate: lint 0 errors, typecheck PASS, 56 files / 328 tests
  PASS, build PASS.

## Local tooling observation

- global `supabase` CLI отсутствует;
- pinned CLI для AP1: `supabase@2.109.1` через `npx`;
- HOME и npm cache CLI изолируются в `/private/tmp`, потому что пользовательские
  `~/.npm` и `~/.supabase` недоступны/не должны меняться;
- Docker доступен; уже работающие unrelated containers не останавливаются и не
  переиспользуются;
- CLI default на дату проверки использует PostgreSQL 17.

## Supabase changelog/doc gate

Проверены официальный changelog и local/custom-schema/Auth docs на 18 июля 2026.
Для AP1 применимы:

- с 28 апреля 2026 новые tables/functions не считаются автоматически exposed в
  Data API; API schemas и grants задаются явно;
- private schemas не включаются в PostgREST exposed schema list;
- PostgreSQL 14 снят с поддержки; AP1 использует PG17, существующая DB matrix
  продолжает отдельно проверять PG16/PG17;
- service-role/secret key не попадает в browser client;
- request-bound human session и RLS/RPC остаются authorization source of truth.

## Environment boundary

- существующий `.env.local` обнаружен, но его значения не печатались и не
  используются AP1 stack;
- local API URL/keys получают только из disposable CLI status;
- test credentials и runtime env хранятся только в `/private/tmp`;
- repository содержит только безопасный `config.toml`, scripts, tests и reports;
- production Supabase project, migration ledger, Auth, Storage, secrets и deploy
  не изменяются.

## Stop conditions

AP1 немедленно останавливается, если:

- URL не loopback/local;
- требуется production access token/project ref;
- CLI пытается link/push к remote;
- migration order отличается от repository ledger;
- private schema появляется в exposed API list;
- test harness печатает anon/service keys, raw tokens или production filenames.
