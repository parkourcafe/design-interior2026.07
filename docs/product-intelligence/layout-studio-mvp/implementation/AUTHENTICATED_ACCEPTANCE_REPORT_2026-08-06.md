# ArchiDom Layout Studio M2 — authenticated acceptance report

Date: 2026-08-06
Branch: `codex/archidom-layout-studio-m2`
Base commit at start: `d56ca6c`
PR: https://github.com/parkourcafe/design-interior2026.07/pull/67 (stays **draft**)

This report closes the `AUTH_BROWSER_HOLD` class from
`NEW_CHAT_HANDOFF_2026-08-06.md`, closes the two `UNVERIFIED` rows, and records
what remains genuinely external.

## 1. How the authenticated hold was cleared

The handoff treated "we need a real ArchiDom user session" as a blocker. It was a
harness problem, and it is now solved without touching production.

Container registries are unreachable from this environment — every image blob CDN
(`d5l0dvt14r5h8.cloudfront.net`, `production.cloudfront.docker.com`,
`pkg-containers.githubusercontent.com`) returns `403 Forbidden` under the egress
policy, so `supabase start` cannot pull. Instead the stack was assembled from
source:

- **PostgreSQL 16.13**, disposable local cluster, GoTrue's 21 migrations applied;
- **GoTrue built from `github.com/supabase/auth@ef6587a`** — the real Supabase Auth
  server, not a stub;
- a 40-line **path router** standing in for Kong's `/auth/v1` route, with no auth
  logic of its own;
- the product's own `/login` page, `/api/auth/register`, `@supabase/ssr` and the
  real `proxy.ts` middleware;
- **Chromium 1194** via Playwright, WebGL through ANGLE/SwiftShader.

The account is created by the product's own registration route and signed in with
`signInWithPassword`. The evidence records GoTrue accepting the resulting browser
token at `/auth/v1/user`, so the session reaching `/app/layout-studio/**` is a
genuine Supabase session. This satisfies `AGENTS.md` — "disposable Supabase, не в
production". No production project, schema, migration or user was touched.

Full reproduction steps: `browser-acceptance/README.md`.

## 2. Result

**49 / 49 authenticated browser checks pass** (`browser-acceptance/evidence/e2e-result.json`),
plus a separate default-off control (`evidence/flag-off-result.json`).

| Gate | Result |
|---|---|
| `npm run lint` | PASS — 0 errors, 10 inherited warnings |
| `npm run typecheck` | PASS |
| `npm run test` | PASS — 75 files / 434 tests (was 70 / 408) |
| Layout Studio suite | PASS — 19 files / 106 tests (was 14 / 80) |
| `npm run build` | PASS — Next.js 16.3.0 |
| `npm audit` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS |
| Migrations | unchanged — `git status supabase/` empty |
| Security review of the diff | no HIGH or MEDIUM findings |

## 3. Defects the browser run found, and what was fixed

The authenticated run was not a formality. It exposed five real defects that all
automated gates had passed over.

**1. Exported SVG did not show openings (`LS-AT-071`, P0).**
`serializeSvgProjection` emitted each opening as an empty `<g …/>` carrying only
`data-offset-mm`/`data-width-mm`. A printed plan showed unbroken walls. Openings
are now drawn as a stroked span resolved onto the parent wall axis, and the
exported SVG is self-contained (background, explicit fills/strokes). Locked by
committed goldens.

**2. Print artifact had no schedule (`LS-AT-074`, P0).**
The row requires "hash / warnings / schedule"; the artifact carried hash and
warnings only. `buildPrintSummary` now renders a deterministic element schedule
(walls → openings → columns → objects) with dimensions in millimetres, escaped.
The KORA artifact carries all 9 rows.

**3. Exporting all five formats left one manifest (`LS-AT-075`, P0).**
Every sidecar was written as `archidom-layout-V1.manifest.json`, so each export
overwrote the previous manifest. The sidecar name now derives from the artifact it
describes, and the PNG manifest uses the same `layout-<hash16>-png` identity as
the other formats.

**4. Version ids collided across documents (`LS-AT-062`, P0).**
Both preview routes shared the browser storage namespace `synthetic-preview-v1`,
but version keys are addressed by `versionId` alone while `listVersions` filters
by `documentId`. Publishing V1 on KORA made the synthetic document's own V1 fail
the immutability guard — silently, as a status message. The repository namespace
is now per document.

**5. Every 3D click destroyed and rebuilt the WebGL context (`LS-AT-044`, `LS-AT-046`).**
`EditorSession.getState()` returns a fresh deep clone per call, so a bare
selection changed the `document` prop identity and re-ran the scene effect: new
renderer, new camera, `forceContextLoss()`, canvas replaced. That cancelled any
in-flight orbit and made "Сбросить камеру" unobservable. The scene is now pinned
to `documentId#stateRevision`, the selection highlight swaps materials on the live
scene instead of rebuilding it, and camera reset restores a stored home pose in
place. Measured: orbit changes 5.9 % of pixels, reset returns to within 0.83 %.

Two smaller fixes came out of the same work: the layer panel's `<details open>`
was a controlled prop, so any unrelated re-render (autosave status) re-collapsed a
group the designer had just opened — disclosure is now user state; and the camera
reset button is disabled until the runtime is ready.

## 4. Ledger changes

`ACCEPTANCE_LEDGER_2026-08-06.csv` introduces `BROWSER_PASS` for rows verified
against a real session in a real browser, distinct from `AUTOMATED_PASS`.

- **`AUTH_BROWSER_HOLD` → `BROWSER_PASS`:** LS-AT-020, 040, 041, 042, 043, 050,
  051, 052, 053, 054, 070, 071, 072, 073, 074, 075, 076, 077, 094.
  (LS-AT-054 is `AUTOMATED_PASS`: the browser has no material UI, so the row is
  closed by the canonical-command contract plus a static test that no
  non-canonical material write exists in the shell.)
- **`UNVERIFIED` → `AUTOMATED_PASS` / `BROWSER_PASS`:** LS-AT-026 (committed SVG
  goldens for KORA and simple-room, with determinism and privacy assertions),
  LS-AT-044 (camera reset measured, above).
- **Also upgraded to `BROWSER_PASS`** because the run covered them directly:
  LS-AT-010, 021, 023, 030, 031, 032, 034, 035, 045, 046, 060, 061, 062, 080, 086.
- **Unchanged `EXTERNAL_HOLD`:** LS-AT-002, 013, 014, 015 (P0) and 091, 092 (P1).
- **Closed 2026-08-07:** LS-AT-012 → `AUTOMATED_PASS`. The owner confirmed the
  clear height is exactly 3 m, so `CLEAR_HEIGHT_ASSUMED_3000` was removed and the
  value gained an owner-lock source ref. That changed the KORA semantic hash to
  `ef57708a…`, so the browser evidence was regenerated (run `r15`, 49/49).

## 5. What remains external — the only blocker

`LS-AT-002`, `013`, `014`, `015` need physical measurements of the KORA
site. They cannot be closed from any code environment, and no assumption was
promoted to a measured value. The exact inputs required are itemised in
`KORA_SURVEY_REQUEST_2026-08-06.md`.

The hold is now enforced rather than merely noted:
`tests/layout-studio/domain/kora-survey-holds.test.ts` fails if the fixture stops
declaring a hold warning, if a warning appears that is not on the documented list,
if owner-confirmed geometry drifts, or if a warning stops propagating into a
published version and its artifacts.

`LS-AT-091`/`092` depend on the same set-out. A provisional browser signal was
recorded (`metrics.provisionalBenchmark`) but is explicitly **not** acceptance: it
was taken on software WebGL against the owner-intent fixture, and the scene will
change once equipment lands.

## 6. Environment caveats recorded with the evidence

- All external hosts are blocked in this sandbox. The app's render-blocking
  `fonts.googleapis.com` stylesheet fails with `ERR_CONNECTION_RESET`; it is the
  sole source of the five `Failed to load resource` console errors and it inflates
  `domContentLoadedEventEnd` to ≈13 s while `responseEnd` is ≈75 ms. No
  same-origin request failed and no uncaught exception occurred.
  **Worth the owner's attention beyond this module:** the same render-blocking
  external font sits in `app/layout.tsx` for the whole app, and Google Fonts is
  unreliable in the target market. Out of Layout Studio scope, not changed here.
- WebGL is software-rendered (ANGLE/SwiftShader). The ~16.7 ms p50 frame time and
  ~15 MB JS heap are real measurements of this environment, not of target hardware.

## 7. Security

A security review of the branch diff produced no HIGH or MEDIUM findings. The new
print schedule escapes every cell; the new SVG opening geometry escapes string
attributes and emits schema-validated integers; the export privacy gate still runs
over the enlarged artifact and was confirmed empirically by `LS-AT-076`; the
manifest filename now passes through `safeFilePart()`.

Regarding the earlier `scan.target.snapshotDigest` tooling failure noted in the
handoff: that plugin is not available in this environment, so **no sealed scan is
claimed for this commit**. What exists is the review above plus `npm audit` at 0
vulnerabilities. The sealed status from `91fe597` covers earlier commits only and
has not been extended.

## 8. Verdict

**NO-GO for production merge.** Not because of a code gate — every code, test,
build, export, browser and dependency gate is green — but because:

1. five P0 rows remain `EXTERNAL_HOLD` pending real KORA measurements;
2. no sealed independent security scan exists for this commit;
3. the handoff requires a repeat independent audit and a separate merge decision
   by the owner (Selena).

The module stays default-off (`ARCHIDOM_LAYOUT_STUDIO_ENABLED=false`), the PR
stays draft, no migration was added or altered, and no production system was
contacted.
