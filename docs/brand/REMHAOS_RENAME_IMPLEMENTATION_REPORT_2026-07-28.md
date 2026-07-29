# RemHaOS Rename Implementation Report — 2026-07-28

Status: `PARTIAL_WITH_OWNER_ACTIONS`

## EXTRACTED repository facts

- Repository root: `/Users/msnigmatullaeva/Documents/designinterior2026/archidom-sprint1`.
- GitHub repository: `parkourcafe/design-interior2026.07`.
- Default branch: `claude/new-session-gsayp3`.
- Working branch / PR: `codex/sprint1-completion-20260728`, PR #53, currently not draft.
- Pre-rename head: `16b80d9`.
- Rename implementation head after preview canonical fix: `ebc3fe7`.
- Latest preview QA evidence head: `563495f`.
- Vercel project from PR checks: `yulaboober/design-interior2026-07`.
- Supabase parent project observed: `ztnycrchwxqczqbyegnp`.
- Supabase Preview branch observed: `qudnbhkvzufotlsskcdc`.
- Current Sprint 1 authenticated preview QA passed on disposable branch `qudnbhkvzufotlsskcdc` for the fallback LLM path: login, project, profile gate, public brief submit, fact confirmation, passport, proposal, human approval, self-approved label, issue, and public proposal page.

## IMPLEMENTED changes

### Public runtime

- Public product name changed to `RemHaOS` in active UI strings.
- Default support email changed to `support@remhaos.com`.
- PWA cache namespace changed to `remhaos-v1`.
- Metadata now uses `https://remhaos.com` as `metadataBase`.
- Open Graph and Twitter metadata use `RemHaOS`.
- `robots.txt`, `sitemap.xml` and `llms.txt` routes were added.
- Private/token/auth routes are excluded from robots indexing.
- Active alt/comment strings were updated to `RemHaOS`.

### Redirects

Configured in `next.config.mjs`:

| Source host | Destination |
|---|---|
| `arhidom.space/:path*` | `https://remhaos.com/:path*` |
| `www.arhidom.space/:path*` | `https://remhaos.com/:path*` |
| `www.remhaos.com/:path*` | `https://remhaos.com/:path*` |

Local verification returned permanent one-hop redirects and preserved path/query:

- `Host: arhidom.space`, `/demo/proposal?x=1` → `https://remhaos.com/demo/proposal?x=1`
- `Host: www.arhidom.space`, `/login` → `https://remhaos.com/login`
- `Host: www.remhaos.com`, `/security` → `https://remhaos.com/security`

### Active documents

Created `docs/canonical/remhaos-v1/` successor package:

- `REMHAOS_CHARTER_v0.5_CANONICAL.md`
- `REMHAOS_PLATFORM_ARCHITECTURE_v1.1.md`
- `REMHAOS_ENTITY_CATALOG_v1.md`
- `REMHAOS_WORKFLOW_CATALOG_v1.md`
- `REMHAOS_DECISION_LOG_v1.md`
- `REMHAOS_READINESS_MATRIX_v1.csv`
- `REMHAOS_EXECUTION_BRIEF_SPRINT_1.md`
- `README.md`

Added `DEC-019` to the RemHaOS decision log.

Imported RemHaOS package docs under `docs/brand/`.

Marked old `docs/canonical/archidom-v1/*.md` documents with a superseded banner. Historical content was preserved.

### Store/email setup docs

Updated current setup docs to use:

- `remhaos.com`
- `support@remhaos.com`
- `noreply@remhaos.com`
- `com.remhaos.twa`

## INTERPRETED decisions

- `RemHaOS` is the only current public brand spelling.
- Public category: `операционная система полного цикла ремонта`.
- Public promise: `от первого брифа до финальной приёмки`.
- Primary positioning: `RemHaOS — операционная система полного цикла ремонта: от первого брифа до финальной приёмки.`
- This is brand positioning, not evidence that M2–M4 are production-ready in Sprint 1.
- `REMHAOS` is allowed only as a technical document/file prefix.
- Legacy host mentions are retained only in redirect compatibility, package instructions and historical evidence.
- Migrations were not rewritten.
- Architecture and product scope were not changed.

## BLOCKED / OWNER_ACTION_REQUIRED

- `https://remhaos.com` production 200 is not proven from repository execution.
- DNS ownership/configuration is not proven from repository execution.
- Vercel production domains must be configured by owner.
- Supabase Auth Site URL and allowed redirect URLs must be updated by owner.
- Email sender domain `remhaos.com` must be verified by owner.
- Search Console / Bing / Yandex Webmaster / analytics domain settings must be updated by owner.
- PR #53 preview live provider-output QA remains not proven because preview health reports `llm_configured=false`; fallback workflow QA passed and the AI-call ledger row was recorded.

## Files changed

Primary runtime/config:

- `.env.example`
- `app/layout.tsx`
- `app/robots.ts`
- `app/sitemap.ts`
- `app/llms.txt/route.ts`
- `app/page.tsx`
- `app/icons/[size]/route.tsx`
- `app/api/assetlinks/route.ts`
- `components/landing/loop-scene.tsx`
- `lib/i18n/ru.ts`
- `lib/env.ts`
- `lib/base-url.ts`
- `next.config.mjs`
- `public/sw.js`

Tests:

- `lib/platform/remhaos-rename-contract.test.ts`

Docs:

- `docs/brand/*`
- `docs/canonical/remhaos-v1/*`
- `docs/canonical/archidom-v1/*.md` superseded banners
- `STORE_SETUP.md`
- `LAUNCH_CHECKLIST.md`
- `RUSTORE_RELEASE.md`
- `supabase/email-templates/README.md`
- `BACKLOG.md`

## Tests and verification

- `npm run lint -- --no-cache`: PASS.
- `npm run typecheck`: PASS.
- `npm run test`: PASS — 62 files, 253 tests.
- `npm run build`: PASS — production build, 19 static pages generated.
- Local discovery routes:
  - `/robots.txt`: PASS, host/sitemap use `https://remhaos.com`.
  - `/sitemap.xml`: PASS, public URLs use `https://remhaos.com`.
  - `/llms.txt`: PASS, canonical host uses `https://remhaos.com`.
- Local redirect checks: PASS for legacy and `www` hosts.
- Browser QA on local production server:
  - Desktop `/`, `/login`, `/demo/brief`, `/demo/proposal`: PASS, console warnings/errors 0, overflow 0, old public brand absent.
  - Mobile 390x844 `/`, `/login`, `/security`: PASS, console warnings/errors 0, overflow 0, old public brand absent.
- PR #53 preview after commit `ebc3fe7`:
  - Vercel: PASS.
  - Supabase Preview: PASS.
  - Vercel Preview Comments: PASS.
  - Preview home title: `RemHaOS — Бриф · Цена · КП`.
  - Preview canonical: `https://remhaos.com`.
  - Preview `og:url`: `https://remhaos.com`.
  - Preview sitemap/robots: `remhaos.com`, no Vercel preview canonical URLs.

## Residual scan

Command:

```bash
rg -n -i --hidden \
  --glob '!node_modules/**' \
  --glob '!.git/**' \
  --glob '!.next/**' \
  --glob '!dist/**' \
  --glob '!build/**' \
  --glob '!coverage/**' \
  'archidom|archi[ -]?dom|arhidom|arhidom\.space|www\.arhidom\.space'
```

Result: 168 matches, all classified exceptions:

- RemHaOS package docs quoting old names to define rename.
- `docs/canonical/archidom-v1/**` historical package with superseded banner.
- `docs/canonical/remhaos-v1/**` successor banner phrase "corresponding ARCHIDOM document".
- Historical reports/handoffs preserving audit provenance.
- Immutable migration comments.
- `next.config.mjs` legacy redirect compatibility.
- `app/layout.tsx` production guard rejecting legacy/preview host as metadata host.
- `lib/platform/remhaos-rename-contract.test.ts` regression test assertions.

Active public runtime residual old-brand matches: clean with explicit redirect/guard/test exceptions.

## Rollback

Safe rollback path:

1. Revert the rename commit(s) from PR #53.
2. Remove `remhaos.com` Vercel/DNS/Auth external changes if already applied.
3. Restore `NEXT_PUBLIC_APP_URL` and support/sender emails to the previous values.
4. Redeploy.

No database migrations were edited for the rename. No production migrations were applied.

## Final statuses

```text
PUBLIC_BRAND: REMHAOS_ONLY_IN_ACTIVE_RUNTIME
PRIMARY_HOST: OWNER_ACTION_REQUIRED
LEGACY_REDIRECTS: PASS_IN_CODE_AND_LOCAL
AUTH_CALLBACKS: OWNER_ACTION_REQUIRED
PUBLIC_TOKEN_COMPATIBILITY: PASS_IN_CODE_PATH_PRESERVATION
SEO_CANONICALS: PASS_IN_CODE
RESIDUAL_SCAN: CLEAN_WITH_EXPLICIT_EXCEPTIONS
PRODUCT_REGRESSION: PASS_LOCAL_TEST_BUILD_PUBLIC_BROWSER
ARCHITECTURE_CHANGED: NO
DATA_LOSS: NO
OWNER_ACTIONS: DOCUMENTED
```
