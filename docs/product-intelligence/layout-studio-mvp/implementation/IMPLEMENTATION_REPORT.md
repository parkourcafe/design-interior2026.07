# ArchiDom Layout Studio M2 — implementation report

Date: 2026-08-04
Branch: `codex/archidom-layout-studio-m2`
Status: `GENERIC_MVP_IMPLEMENTED / KORA_COORDINATE_GATE_BLOCKED`

## Outcome

Implemented an additive, default-off Layout Studio experiment under
`/app/layout-studio`. One canonical integer-millimeter document drives validation,
commands, semantic hashing, diff, derived geometry, SVG, Three scene descriptors,
local draft/checkpoints/immutable versions and open-format exports.

The included Liquid Station fixture is intentionally synthetic. It proves the product
workflow but is not KORA evidence and must not be handed to an architect as measured
geometry.

## Delivered

- Pure TypeScript domain with controlled validation issues and immutable commands.
- Stable IDs, optimistic `stateRevision`, locked structural entities and exact diff.
- Canonical serialization and SHA-256 semantic hash.
- Wall polygons, opening checks, room area/bounds and a shared scene projection.
- SVG plan, selection, layers, zoom/fit and numeric inspector.
- Three scene compiler/runtime, WebGL availability boundary and resource disposal.
- Undo/redo, local autosave/reload, checkpoints and immutable local versions.
- JSON, SVG, PNG, GLB, print and privacy-checked export contracts.
- Strict server-only default-off flag `ARCHIDOM_LAYOUT_STUDIO_ENABLED`.
- Centralized Russian copy and isolated editor styles.
- No migrations, production access, service role, AI, proprietary assets or `.plan`
  parser.

## Automated evidence

- Layout Studio tests: domain, application, local persistence, SVG, Three, exports,
  fixture and integration/static boundaries.
- Full repository gates are recorded in `ACCEPTANCE_CLOSEOUT.md`.
- Browser HTTP smoke: flag on returns the editor; flag off returns 404.
- Browser visual smoke: WebGL scene rendered successfully with no console errors.

## Known limitations

- KORA coordinate acceptance LS-AT-010..016 is blocked by missing authoritative
  plan revision and coordinate table.
- The experiment is desktop-first local persistence, not multi-user production CAD.
- Browser visual and interaction quality must still receive an owner walkthrough on
  the target desktop before a GO decision.
- Existing dependency audit findings are inherited from the repository; no automated
  force-upgrade was applied. The final audit reports 12 advisories (8 moderate, 4
  high), including current Next/PostCSS/transitive tooling findings; remediation is a
  separate repository-wide dependency change, not hidden as part of this spike.

## Five-minute manual check

1. Set `ARCHIDOM_LAYOUT_STUDIO_ENABLED=true`.
2. Run `npm run dev` and open `/app/layout-studio` at desktop width.
3. Select the synthetic column and verify 250 × 250 mm and locked editing.
4. Move an unlocked equipment object, then use undo/redo and switch 2D/3D.
5. Create a checkpoint, publish two local versions and inspect the diff.
6. Reload and verify the draft is restored.
7. Export JSON/SVG/PNG/GLB and print the summary.
8. Unset the flag and confirm the route returns 404.

## Integration boundary

Future M2 integration should replace the synthetic fixture with an owner-approved KORA
coordinate freeze and connect the repository port to authenticated Project/Package
contracts. It must not bypass request-bound identity or write private Project
Intelligence tables directly.
