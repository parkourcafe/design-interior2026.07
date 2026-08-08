# Authenticated browser acceptance harness — ArchiDom Layout Studio M2

Date: 2026-08-06
Branch: `codex/archidom-layout-studio-m2`

This directory holds the harness and the captured evidence for the rows that the
2026-08-06 handoff listed as `AUTH_BROWSER_HOLD`. It is documentation and a
runnable script; nothing here is imported by the product and nothing here adds a
runtime dependency.

## What "authenticated" means here

The run uses a **real Supabase session**, not a stub:

| Layer | What actually runs |
|---|---|
| Auth server | `gotrue` built from source at `github.com/supabase/auth` (`ef6587a`) |
| Database | PostgreSQL 16.13, disposable local cluster, 21 GoTrue migrations applied |
| Gateway | `harness/gateway.mjs` — path routing only (`/auth/v1/*` → GoTrue), the role Kong plays in a real deployment. It contains no auth logic. |
| Client | The product's own `/login` page, `@supabase/ssr`, and the real `proxy.ts` middleware |
| Browser | Chromium 1194 via Playwright, WebGL through ANGLE/SwiftShader |

The account is created through the product's own `POST /api/auth/register`
(service-role `auth.admin.createUser`) and signed in with
`supabase.auth.signInWithPassword`. The evidence records that GoTrue's
`/auth/v1/user` accepts the resulting browser token, so the session that reaches
`/app/layout-studio/**` is a genuine Supabase session.

This is a **disposable** Supabase in line with `AGENTS.md` ("Authenticated Pilot
Gate в disposable Supabase, не в production"). No production project, schema,
migration or user was touched.

## Reproducing the run

Requirements: Docker is **not** needed. PostgreSQL 16 server binaries, Go ≥ 1.24
(to build GoTrue), Node 22, and a Chromium that Playwright can drive.

```bash
# 1. disposable Postgres
initdb -D "$PGDIR" -U supabase_admin --auth=trust -E UTF8
pg_ctl -D "$PGDIR" -o "-p 55432 -c unix_socket_directories='' -c listen_addresses=127.0.0.1" start
psql -h 127.0.0.1 -p 55432 -U supabase_admin -d postgres -f roles.sql   # anon, authenticated,
                                                                        # service_role, authenticator,
                                                                        # supabase_auth_admin, postgres,
                                                                        # schema auth

# 2. real Supabase Auth
git clone --depth 1 https://github.com/supabase/auth.git && (cd auth && go build -o gotrue .)
./gotrue migrate --config gotrue.env
./gotrue serve   --config gotrue.env      # 127.0.0.1:9999

# 3. gateway that mimics Kong's /auth/v1 route
node harness/gateway.mjs                  # 127.0.0.1:54321 -> 127.0.0.1:9999

# 4. the product, flag ON, pointed at the disposable stack
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon jwt signed with GOTRUE_JWT_SECRET> \
SUPABASE_SERVICE_ROLE_KEY=<service_role jwt signed with the same secret> \
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3100 \
ARCHIDOM_LAYOUT_STUDIO_ENABLED=true \
npm run build && npx next start -p 3100 -H 127.0.0.1

# 5. acceptance run
E2E_OUT=./evidence E2E_RUN_ID=r15 E2E_ANON_KEY=<anon jwt> node harness/e2e.mjs

# 6. default-off control: restart step 4 with ARCHIDOM_LAYOUT_STUDIO_ENABLED unset
E2E_OUT=./evidence node harness/flag-off.mjs
```

`gotrue.env` needs `GOTRUE_CORS_ALLOWED_HEADERS=apikey,x-supabase-api-version,x-client-info,x-client-ip`;
GoTrue's default allow-list omits `apikey`, which Kong normally supplies, and the
browser preflight fails without it.

## Files

- `harness/e2e.mjs` — the 49-check acceptance run.
- `harness/flag-off.mjs` — default-off control (authenticated user still gets 404).
- `harness/gateway.mjs` — `/auth/v1` router.
- `harness/png-tools.py` — PNG decode helpers for screenshot statistics and diffs.
- `evidence/e2e-result.json` — every check with its measured detail, console log,
  network log and metrics. Screenshot paths are repo-relative.
- `evidence/flag-off-result.json` — default-off control result.
- `evidence/screenshots/*.png` — 10 captures referenced by the checks.
- `evidence/exports/*` — the five artifacts and their sidecar manifests, exactly
  as the browser downloaded them.

## Result of the recorded run (`r15`, 2026-08-07)

49 / 49 checks pass. `evidence/e2e-result.json` carries the per-check detail.

Re-run on 2026-08-07 after the owner confirmed the 3 m clear height: removing
`CLEAR_HEIGHT_ASSUMED_3000` changed the KORA semantic hash to
`ef57708a1deb66b47454901eb9b5af83460bddb19986e116d926f3f455833a11`, so the whole
evidence set was regenerated rather than left stale.

## Environment caveats that the evidence records

- **All external hosts are blocked** in the sandbox that produced this run. The
  app's render-blocking `fonts.googleapis.com` stylesheet therefore fails with
  `ERR_CONNECTION_RESET`, which is the sole source of the five
  `Failed to load resource` console errors and inflates `domContentLoadedEventEnd`
  to ~13 s while `responseEnd` is ~75 ms. No same-origin request failed.
- **WebGL is software-rendered** (ANGLE / SwiftShader). Frame timing (~16.7 ms p50)
  and the ~15 MB JS heap are real measurements of this environment, not of target
  hardware.
- `LS-AT-091/092` stay `EXTERNAL_HOLD`: the benchmark in `provisionalBenchmark` is
  a signal on the owner-intent fixture, not acceptance for the final set-out.
