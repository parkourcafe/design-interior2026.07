# RemHaOS Rename Inventory — 2026-07-28

Status: IMPLEMENTED_WITH_BLOCKERS

## Repository facts

- Repository root: `/Users/msnigmatullaeva/Documents/designinterior2026/archidom-sprint1`.
- GitHub repository: `parkourcafe/design-interior2026.07`.
- Default branch: `claude/new-session-gsayp3`.
- Working branch / PR: `codex/sprint1-completion-20260728`, PR #53, draft.
- Head before rename pass: `16b80d9 Record preview Supabase routing blocker`.
- Vercel project observed from PR checks: `yulaboober/design-interior2026-07`.
- Latest pre-rename PR checks: Vercel pass, Supabase Preview pass, Vercel Preview Comments pass.
- Supabase parent project observed: `ztnycrchwxqczqbyegnp`.
- Supabase preview branch observed: `qudnbhkvzufotlsskcdc`.

## Canonical rename contract

- Official public brand: `RemHaOS`.
- Russian pronunciation: `РемХаос`.
- Technical prefix: `REMHAOS`.
- Primary host: `https://remhaos.com`.
- Architecture scope: unchanged.

## Active runtime surfaces found

| Surface | Classification | Action |
|---|---|---|
| `lib/i18n/ru.ts` | PUBLIC_REPLACE | Replaced visible `ARHIDOM` strings with `RemHaOS`. |
| `app/layout.tsx` | PUBLIC_REPLACE | Added `metadataBase`, canonical, Open Graph, Twitter metadata using `remhaos.com`. |
| `app/manifest.ts` | PUBLIC_REPLACE | Inherits `RemHaOS` from i18n. |
| `public/sw.js` | PUBLIC_REPLACE | Cache namespace changed to `remhaos-v1`. |
| `lib/env.ts`, `.env.example` | PUBLIC_REPLACE / EXTERNAL_CONFIG | Default support email changed to `support@remhaos.com`. |
| `components/landing/loop-scene.tsx` | PUBLIC_REPLACE | Image alt text changed to `RemHaOS`. |
| `app/icons/[size]/route.tsx` | PUBLIC_REPLACE | Brand comment changed to `RemHaOS`. |
| `app/api/assetlinks/route.ts`, `.env.example` | EXTERNAL_CONFIG | TWA package-name examples changed to `com.remhaos.twa`. |
| `next.config.mjs` | LEGACY_REDIRECT | Added one-hop host redirects to `https://remhaos.com/:path*`. |
| `app/robots.ts`, `app/sitemap.ts`, `app/llms.txt/route.ts` | PUBLIC_REPLACE | Added discovery files using canonical `remhaos.com`. |

## Active documents found

Created brand-only successors under `docs/canonical/remhaos-v1/`:

- `REMHAOS_CHARTER_v0.5_CANONICAL.md`
- `REMHAOS_PLATFORM_ARCHITECTURE_v1.1.md`
- `REMHAOS_ENTITY_CATALOG_v1.md`
- `REMHAOS_WORKFLOW_CATALOG_v1.md`
- `REMHAOS_DECISION_LOG_v1.md`
- `REMHAOS_READINESS_MATRIX_v1.csv`
- `REMHAOS_EXECUTION_BRIEF_SPRINT_1.md`
- `README.md`

Imported package documents under `docs/brand/`.

## Historical / immutable surfaces intentionally retained

- `supabase/migrations/**`: MIGRATION_KEEP. Historical SQL comments and rollback references were not rewritten.
- `docs/canonical/archidom-v1/**`: HISTORICAL_KEEP. Marked with superseded banner and preserved for provenance.
- `docs/reports/ARCHIDOM_*_2026-07-27.md`: HISTORICAL_KEEP. Evidence names and historical branch names retained.
- `HANDOFF_CINEMATIC.md`, `LANDING_REPORT.md`: HISTORICAL_KEEP. Prior-session handoff/report evidence retained.
- Redirect config in `next.config.mjs`: LEGACY_REDIRECT. Old domains remain only as compatibility hosts.
- Brand package documents: HISTORICAL_KEEP / CONTRACT_REFERENCE. They quote old names to define the rename.

## External configuration not directly changed

OWNER_ACTION_REQUIRED:

- Vercel: attach `remhaos.com` as production domain and `www.remhaos.com` as redirect/alternate.
- DNS: point `remhaos.com` to Vercel.
- Supabase Auth: update Site URL and allowed redirects for `https://remhaos.com/auth/callback`, `https://remhaos.com/login`, and preview callback URLs.
- Email provider: verify sender domain `remhaos.com`; update sender to `noreply@remhaos.com`.
- Search Console / Webmaster / analytics: create/verify new domain properties and submit sitemap.

