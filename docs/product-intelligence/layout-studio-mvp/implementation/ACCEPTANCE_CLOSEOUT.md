# Layout Studio acceptance closeout

Date: 2026-08-04

## Automated result

| Area | Result | Evidence |
|---|---|---|
| Contract/units | PASS | domain tests |
| Commands/hash/diff | PASS | domain tests |
| Synthetic geometry | PASS | domain + integration tests |
| 2D projection/editor contract | PASS | SVG + integration tests |
| Editing/undo/redo | PASS | application tests |
| Three projection/runtime/disposal | PASS | Three adapter tests |
| Local draft/checkpoints/versions | PASS | local adapter tests |
| Export/privacy/exact version | PASS | export service tests |
| Feature flag off/on | PASS | integration test + HTTP smoke |
| No migrations/domain dependency boundary | PASS | integration static tests |
| Full test/typecheck/build/lint | PASS | final gate run; lint has inherited warnings only |

## P0 exceptions

LS-AT-010..016 are `BLOCKED`, not passed. The package contains no authoritative KORA
coordinates. Required inputs are listed in `KORA_COORDINATE_FREEZE.md`. No waiver is
assumed and no synthetic coordinate is presented as KORA evidence.

## Browser HTTP smoke

- `ARCHIDOM_LAYOUT_STUDIO_ENABLED=true`: `/app/layout-studio` returned HTTP 200 and
  contained “Редактор планировки” and “Синтетический набор данных”.
- Flag unset/default false: the same route returned HTTP 404.

## Browser visual smoke

The production build was opened in the in-app browser with the flag enabled. Verified:

- 2D plan, 33.12 m² synthetic room and all editor rails render;
- switching 2D → 3D preserves document revision;
- WebGL scene renders walls, openings, the column, equipment and ceiling;
- reset-camera and ceiling controls are present;
- versions, inspector and export controls remain visible;
- browser console contains no errors or warnings.

## Manual owner gate

A visual walkthrough, export opening check and exact KORA coordinate review remain
human gates. Generic MVP completion must not be relabelled `PRODUCTION_READY=true`.
