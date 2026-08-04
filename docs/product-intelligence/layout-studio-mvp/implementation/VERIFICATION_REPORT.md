# ArchiDom Layout Studio — verification report

Date: 2026-08-04  
Branch: `codex/archidom-layout-studio-m2`

## Result

The synthetic technical MVP passes its automated and production-build gates. The
KORA Liquid Station acceptance gate cannot be executed because the supplied package
does not contain an authoritative plan revision or coordinate table.

## Reproducible checks

| Check | Result |
|---|---|
| Layout Studio suite | PASS — 14 files, 75 tests |
| Full repository suite | PASS — 70 files, 403 tests |
| ESLint | PASS — 0 errors; 9 inherited warnings outside this module |
| TypeScript strict check | PASS |
| Next.js production build | PASS; `/app/layout-studio` emitted as a dynamic route |
| `git diff --check` | PASS |
| Supabase migration diff | PASS — none |
| Feature flag disabled | PASS — route returns not found |
| Feature flag enabled | PASS — browser smoke rendered 2D and WebGL 3D without console errors |

## Acceptance disposition

- PASS: schema validation, stable IDs, references, semantic hash and deterministic derivation.
- PASS: pan/fit, layers, dimensions, labels, clearance display, numeric edits, locks and undo/redo.
- PASS: one canonical document drives SVG and 3D; walls, openings, floor, ceiling, materials and lights derive from it.
- PASS: CAS draft persistence, immutable checkpoints/versions, restore-as-new-revision and field-level diff.
- PASS: exact-version JSON, SVG, GLB and print exports with manifest, checksum, warnings and privacy rejection.
- BLOCKED: KORA recognizability, exact Tenant 12 contour, stated 3000 mm anchor, EQ-04 height and KORA export comparison.

The synthetic fixture is evidence for software behavior only. It is not KORA evidence
and must not be renamed or promoted as such.
