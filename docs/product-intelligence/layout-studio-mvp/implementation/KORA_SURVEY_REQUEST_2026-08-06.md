# KORA Liquid Station — survey inputs still required

Date: 2026-08-06
Branch: `codex/archidom-layout-studio-m2`
Blocks: `LS-AT-002`, `LS-AT-012`, `LS-AT-013`, `LS-AT-014`, `LS-AT-015` (P0) and
`LS-AT-091`, `LS-AT-092` (P1).

These rows are `EXTERNAL_HOLD`. They cannot be closed from the repository or from
any automated environment: they need physical measurements. Nothing below is
inferred, and no assumption in the fixture has been promoted to a measured value.

## Already locked by the owner (2026-08-04) — do not re-measure

| Input | Value | Where it lives |
|---|---|---|
| Room contour | 8100 × 3000 mm | `nodes` in the fixture |
| Column section | 250 × 250 mm | `column.kora.center` |
| Door width | 1200 mm, centred on the column axis (X = 3835 mm) | `opening.kora.rear-door` |
| Left side | 1500 mm open / 1500 mm wall | `opening.kora.left-access` |
| Right wall | continuous, no opening | `wall.kora.right` |
| Guest counter height | 1100 mm | `object.kora.counter` |
| Work surface height | 900 mm | `object.kora.worktop` |

`tests/layout-studio/domain/kora-survey-holds.test.ts` fails if any of these
drift, and fails if a hold below stops being declared.

## Still required

### 1. Clear room height — closes `LS-AT-012`
Currently `floor.clearHeightMm = 3000` and the column height is `3000`, both
carrying the warning `CLEAR_HEIGHT_ASSUMED_3000`.

Measure: finished-floor to finished-ceiling clear height, and the same for the
lowest structural or service obstruction if it differs. Give both, in mm.

### 2. Door height, frame and swing — closes `LS-AT-013`
Currently `heightMm = 2100`, `sillMm = 0`, `handing = "double"`, warning
`DOOR_HEIGHT_AND_SWING_NOT_SITE_VERIFIED`.

Measure: structural opening height; frame thickness and whether the 1200 mm is
the structural opening or the clear passage; leaf configuration and swing
direction (in/out, left/right, or confirm double).

### 3. Column absolute axis — closes the `COLUMN_ABSOLUTE_AXIS_NOT_SITE_VERIFIED`
part of `LS-AT-002`
The fixture places the column centre at X = 3835 mm, Y = 1125 mm, derived from the
owner's "door on the column axis" statement rather than a site tie-in.

Measure: the column centre distance from two adjacent finished wall faces, naming
which walls. Confirm the 8100 mm and 3000 mm sides are measured to finished faces
and not to structure.

### 4. Rear equipment set-out — closes `LS-AT-014`
The fixture has no rear equipment; it only carries the warning
`EQUIPMENT_SET_OUT_PENDING`.

For each unit: designation, X and Y of its centre or of its left/near corner
(state which), width × depth × height, plinth height, and any required service
clearance. Include equipment fixed to the rear wall as well as free-standing.

### 5. Central sink set-out — closes `LS-AT-015`
Same fields as above for the central sink: bowl count, overall width × depth,
rim height, X/Y of the centre, and clearance to the counter and to the column.

### 6. After 1–5: interaction benchmark — closes `LS-AT-091`, `LS-AT-092`
Once the final set-out is in the fixture, re-run
`docs/product-intelligence/layout-studio-mvp/implementation/browser-acceptance/harness/e2e.mjs`
on target hardware with hardware WebGL. The current run records a provisional
signal only (`metrics.provisionalBenchmark` in `evidence/e2e-result.json`), taken
on software WebGL with a different scene, and is not acceptance for these rows.

## How to deliver

A table (any format) with the fields above, plus who measured and when. Once it
lands, `fixtures/layout-studio/kora-liquid-station.v0.1.json` gains the values,
the corresponding warning codes are removed, and
`tests/layout-studio/domain/kora-survey-holds.test.ts` is updated in the same
commit so the removed hold cannot be silently reintroduced.

## What must not happen

No coordinate may be taken from a rendering, a photograph, an AI estimate or a
proportional reading of a perspective image. A hold stays open until a measured
value replaces it.
