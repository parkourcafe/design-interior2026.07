# WP-26 — BUG-05 (б): страницы дизайнера → request-bound + RLS — EVIDENCE

Дата: 2026-09-10. Ветка: `wp/wp-26-designer-pages-request-bound`. База: `1e132cb47bc9893ac1d46c46051898cf1df0eb70`. HEAD: candidate commit pending fresh-main sync. PR: pending.

## Основание

[ИЗВЛЕЧЕНО] Карточка `docs/execution/wp/WP-26-designer-pages-request-bound.md`: authenticated studio/dashboard reads use `lib/supabase/server.ts` and existing RLS; raw service-role usage is retained only where a public token-bound contract or an explicitly approved follow-up is still required.

[ИЗВЛЕЧЕНО] Existing legacy policies in `supabase/migrations/20260716071024_legacy_production_baseline.sql` allow studio members to read `studio_members`, `designers`, and project-owned legacy rows through `public.is_studio_member(owner_id, auth.uid())`. The same baseline has no `storage.objects` policy for the private `client-uploads` bucket and no invite-token lookup/acceptance policy for an unauthenticated or pre-membership user.

## Allowlist по факту

The tracked candidate diff (`git diff --name-only`) contains two files, and
`git status --short` adds the one untracked evidence file:

```text
lib/studio.ts
tests/release/service-role-allowlist.test.ts
docs/audits/wp/WP-26_EVIDENCE.md
```

All three candidate paths are in the WP-26 allowlist. No migration, CI, release, production, or secret file was changed.

## Изменения

- `lib/studio.ts`: removed the raw admin client. Active membership and owner profile reads now use the request-bound `createClient()` client. Owner creation already used the same client through `getOrCreateDesigner()`.
- `app/dashboard/projects/[id]/page.tsx`: unchanged. Its attachment signing remains a `BLOCKED_HOTSPOT` because the private bucket has no project-scoped request-bound Storage policy.
- `tests/release/service-role-allowlist.test.ts`: removed the resolved `lib/studio.ts` path and reclassified the dashboard path as `BLOCKED_HOTSPOT`. Remaining raw callers are blocked hotspots: public token paths are class (b), while dashboard Storage, invite, and pilot paths require separate policies or contracts; this inventory is not permission for new usages.

## Хотспоты и вынесенное

No migration slot was reserved or used. The following paths remain unchanged and are recorded honestly:

| Path | Status | Reason |
|---|---|---|
| `lib/intake.ts` | `BLOCKED_HOTSPOT` / class (b) | Public intake routes need exact token + expiry lookup before an authenticated session exists; current anon RLS cannot see the row. The public token path must be split from authenticated helpers or receive an approved request-bound contract. |
| `lib/designer.ts` | `BLOCKED_HOTSPOT` / class (b) | `/i/[token]` displays the designer profile after the exact public intake token has bound the project; request-bound anon RLS cannot read the profile, including the fallback auth email. The public token path must be split from authenticated helpers or receive an approved request-bound contract. |
| `app/join/[token]/page.tsx` | `BLOCKED_HOTSPOT` | Invite preview is available before login; existing RLS has no safe token lookup contract. An anon policy based on a query value would be unsafe. |
| `app/join/[token]/actions.ts` | `BLOCKED_HOTSPOT` | Before acceptance the invited row is invisible to the request-bound user; acceptance also needs an atomic token consume contract. |
| `app/api/pilot/route.ts` | `BLOCKED_HOTSPOT` | Anonymous insertion of the fixed `pilot_request` event needs an additive policy; the current events policy requires a studio member and does not admit `NULL` ownership. |
| dashboard `client-uploads` signing | `BLOCKED_HOTSPOT` | The existing code remains service-role based because the private bucket has no project-scoped `storage.objects` policy in the baseline. Hosted behavior must not be claimed until that policy is approved and tested. |

The minimal follow-up is an approved contract that splits public token readers from authenticated helpers, plus any necessary project-scoped Storage and secure invite lookup/acceptance policies. This candidate does not author them because S-MIG is occupied by WP-21 and the parent explicitly withheld a migration slot.

## Pins

No pins changed. Existing `is_studio_member` behavior and project ownership checks are preserved.

## Миграция

None. DB4/DB5 were not run because no SQL was changed.

## Локальные гейты

Environment: Node/npm as reported by the checkout; dependencies installed with:

```text
npm ci --cache /private/tmp/remhaos-npm-cache-20260909 --no-audit --no-fund  # exit 0
```

Focused tests:

```text
./node_modules/.bin/vitest run tests/release/service-role-allowlist.test.ts tests/release/supabase-auth-boundary.test.ts
# 2 files passed, 25 tests passed, exit 0
```

`git diff --check`: exit 0. `npm run release:check` exit 0 (lint, typecheck, full test suite, and build). No CI or hosted checks were run.

## Grep-проверки

Initial grep-first inventory on fresh `origin/main` found raw callers in all listed residual paths. After the candidate:

```text
rg -n "createAdminClient" lib/studio.ts
# no matches
```

The remaining target raw callers are `app/dashboard/projects/[id]/page.tsx`, `lib/intake.ts`, `lib/designer.ts`, `app/join/[token]/page.tsx`, `app/join/[token]/actions.ts`, and `app/api/pilot/route.ts`; their class (b) or `BLOCKED_HOTSPOT` classifications and reasons are listed above.

## Не сделано / вынесено

- No invite RLS/RPC migration: `BLOCKED_HOTSPOT`, pending exact contract and S-MIG slot.
- No Storage policy migration: `BLOCKED_HOTSPOT`, pending project-scoped policy and DB4/DB5 coverage.
- No raw-to-request-bound rewrite of public intake helpers: governing roadmap and R26 classify these target helpers as class (b); their public callers need a split or approved token-bound request contract.
- No migration, release deployment, hosted migration, production change, or secret access.

## Blind review

Not run yet. Candidate has unresolved hotspots requiring the owner-approved contract below.

## Безопасность

[ИЗВЛЕЧЕНО] No production system or connector was used. No secrets were read or written. No existing migration was modified. The request-bound conversions rely on existing `auth.uid()` and `is_studio_member` RLS checks; unresolved public paths are explicitly held rather than given a broad anonymous policy.
