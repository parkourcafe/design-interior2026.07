# Layout Studio MVP — Gate 0 baseline

Date: 2026-08-04
Branch: `codex/archidom-layout-studio-m2`
Baseline commit: `9470fceb0912b5546d2d53b297a6a01c8c3d28a8`
Specification package commit: `69419ad`

## Repository state

The implementation runs in the dedicated worktree
`/Users/msnigmatullaeva/Documents/designinterior2026/archidom-layout-studio-m2`.
The source worktree was dirty, so none of its uncommitted files were copied or changed.
The implementation worktree was clean before LS-000 documentation was added.

## Baseline gates

- `npm run test`: PASS — 56 files, 328 tests.
- `npm run typecheck`: PASS.
- `npm run build`: PASS — 18 routes generated.
- `npm run lint`: PASS with 9 pre-existing warnings and no errors.
- Production credentials, service role and Supabase migrations: not used.

## Gate 0 status

`GO_WITH_SYNTHETIC_FIXTURE=true`. Product/domain/editor work may proceed against the
synthetic fixture. `KORA_COORDINATE_FREEZE=false`: the supplied evidence manifest has
TBD coordinates and explicitly forbids inventing them. KORA geometry acceptance remains
blocked until an authoritative coordinate table is supplied; this does not block the
generic product implementation or synthetic acceptance suite.

## Planned additive paths

- `lib/layout-studio/domain/**`
- `lib/layout-studio/application/**`
- `lib/layout-studio/adapters/{local,svg,three}/**`
- `components/layout-studio/**`
- `app/app/layout-studio/**`
- `fixtures/layout-studio/**`
- `tests/layout-studio/**`
- `docs/product-intelligence/layout-studio-mvp/implementation/**`

Existing files may receive only minimal additive feature-flag, dependency, i18n or
styling changes. `supabase/migrations/**`, production auth and existing `projectceo_*`
contracts are out of scope.
