# ArchiDom RU — Supabase Auth & Protected Routes Report

Дата: 19 июля 2026 года  
Supabase project ref: `ztnycrchwxqczqbyegnp` (`design2026`)  
Scope: local application hardening + production read-only observation

```text
LOCAL_AUTH_BOUNDARY=PASS
PRODUCTION_CHANGED=false
PRODUCTION_READY=false
PRODUCTION_APPLIED=false
```

## Реализовано локально

- `/dashboard/:path*` остаётся единственным UI matcher в Next.js Proxy; публичные
  intake/proposal/invitation/guest routes не были превращены в authenticated routes.
- Proxy теперь валидирует подпись JWT через `supabase.auth.getClaims()` перед
  допуском к dashboard. `getSession()` в server-side boundary не используется.
- При refresh сессии Proxy переносит cookies в request/response и применяет
  cache headers, возвращённые актуальным `@supabase/ssr`.
- Browser/server/proxy clients предпочитают modern publishable key и сохраняют
  legacy anon key как compatibility fallback.
- `@supabase/ssr` и `@supabase/supabase-js` обновлены и закреплены точными
  версиями в `package.json`/lockfile.
- Добавлен статический regression contract
  `tests/release/supabase-auth-boundary.test.ts`.

ProjectCEO API routes по-прежнему используют request-bound human JWT и
server-side verification в `request-context.ts`; service role не добавлялся в
human runtime.

## Проверка

```text
npm run typecheck  PASS
npm run lint       PASS (0 errors; 9 pre-existing warnings)
npm run test       PASS (70 files, 397 tests)
npm run build      PASS
npm audit          PASS (0 vulnerabilities)
```

## Production read-only observation

- Project status: `ACTIVE_HEALTHY`.
- Region: `ap-northeast-1`.
- PostgreSQL: `17.6.1.141`.
- Supabase migration ledger: empty (`[]`).
- Security advisor: legacy `public.is_studio_member(uuid, uuid)` remains a
  publicly executable `SECURITY DEFINER` function for `anon` and
  `authenticated`; leaked-password protection is disabled; `rate_limits` has
  RLS enabled with no policy.
- Performance advisor reports legacy unindexed foreign keys and non-initplan
  `auth.*` calls in RLS policies.

These observations do not authorize or apply a production change. The empty
ledger, legacy security debt, Auth configuration, clone rehearsal and human
sign-offs remain production-adoption blockers under the active plan.

## Verdict

The local SSR Auth boundary and protected dashboard routing are ready for the
next disposable/clone rehearsal. Production remains NO-GO and unchanged.
