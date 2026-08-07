# KORA Liquid Station — survey inputs still required

Date: 2026-08-06 (updated 2026-08-07)
Branch: `codex/archidom-layout-studio-m2`
Blocks: `LS-AT-002`, `LS-AT-012`, `LS-AT-013`, `LS-AT-014`, `LS-AT-015` (P0) and
`LS-AT-091`, `LS-AT-092` (P1).

## Venue naming

**KORA is the former name of the venue now called ODE Ubud Foodhall** (owner
confirmation, 2026-08-07). Same building, same project. Code identifiers keep the
`kora` namespace (`layout.kora.liquid-station`, `fixtures/layout-studio/kora-*`)
as a compatibility namespace, exactly as `ProjectCEO` is kept for the platform
code. Do not rename them without a separate migration decision.

When requesting drawings, address them to the **ODE** drawing series — that is the
name the drawing team uses today. `AGENTS.md` still says "Kora Food Hall около
1 800 м²"; aligning that wording is a separate governance edit, not made here.

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

## Correction (2026-08-07): the measurements exist — they were never imported

The owner asked, correctly, why measurements are still being requested when the
survey was already handed over. They were. The gap is not the survey; it is the
import.

`docs/product-intelligence/agent-runs/ru-validation/` registers a full source
package — 209 physical sources, ~1.25 GB, indexed by SHA-256 in
`kora-food-hall-source-manifest` (the machine-readable copy was retired from
`public/` in `1c803b0` and is still recoverable at `1c803b0^`). Roots:
`kora ubud bali 03.06.2026/KORA_Construction` (primary working collection) and
`.../05 Kora Food Hall` (issued package candidate).

Two statements in that register explain the current state:

- `restaurant-second-floor-input.md`: *"геометрия DWG пока не интерпретируется"*;
- `restaurant-second-floor-supplemental-sources.md`: *"No source has been uploaded
  to production"*, and every extracted value stays `unknown`/`interpreted` until
  human review.

So `LS-AT-002/012/013/014/015` are open because **nobody extracted the values into
`fixtures/layout-studio/kora-liquid-station.v0.1.json`** — not because the site was
never measured. The files sit in the owner's local project folders; the repository
holds only their names, hashes and classification.

### Which registered sources close which row

Mapping by the manifest's own `floor`/`discipline` classification. `local` means
the file was materialized on the owner's machine; `cloud_placeholder` means only a
reference was recorded.

| Row | Registered source | Availability |
|---|---|---|
| LS-AT-014, LS-AT-015 | `Kora Food Hall - 2nd Floor - AD06 - Service Area.pdf` | local, current |
| LS-AT-002 | `План_2-го_этажа_структурный.png` (structural) | local, reference |
| LS-AT-002 | `План_2-го_этажа_1-100.pdf` | local, reference |
| LS-AT-013 | `Kora Food Hall - 2nd Floor - A05 - Doors & Windows Rev 2.pdf` | local, current |
| LS-AT-013 | `A05-102_Двери_и_окна_2-й_этаж_1-150.pdf` | local, reference |
| LS-AT-013 | `2F Technical Specification Kora Foodhall Doors.pdf` | cloud placeholder |
| LS-AT-012 | `Разрез_здания.png`, `Разрез_здания_15-25_градусов.pdf` | local |
| LS-AT-015 | `сантехника.pdf`, `01. FINAL MEP PLUMBING 14-01-24.dwg` | cloud placeholder |
| LS-AT-014 | `KORA_MEP_Equipment_Procurement.xlsx` | cloud placeholder |
| all | `DWG - Restaurant Second Floor.rar` (24 DWG + drawing-list XLSX) | local, reference |
| context | `2st floor size_250719_211919.pdf`, `furniture_layout_final.png` | cloud placeholder |

`ODE-Final Design.pdf` is registered under `floor = second_floor_toilet`, which
matches the package supplied on 2026-08-07 and confirms it is not the Liquid
Station sheet.

**Caveat:** which sheet actually carries the Liquid Station is inferred from names
and disciplines, not from having opened them. `AD06 - Service Area` is the
strongest candidate. It is a lead to check, not a verified fact.

### Reviewed 2026-08-07: four sheets supplied, none is the Liquid Station

| Supplied | What it is | Closes |
|---|---|---|
| `AD06 - Service Area.pdf` (3 sheets, AD06-101…103, 2 May 2026) | back-of-house service corridor, 15040 × 2030 mm: SHISHA / SERVICE / ELECTRICAL, service doors, existing exhaust + fresh-air ducting, light-steel roof, rain gutter | nothing |
| `AD05 - Main Stair.pdf` (4 sheets) | main stair | nothing |
| `AD01 - Secondary Skin.pdf` (38 pp, 37 sheets AD01-101…602) | façade/skin package only — plans, situation plans, 9 elevations, 8 sections, frame details. The drawing list on p1 confirms all 37 sheets are Secondary Skin; there is no interior sheet | nothing directly |
| `3D Exterior.pdf` (11 pp) | visualisation | nothing — renderings are excluded as a coordinate source by policy |

**Genuine progress from `AD01-401 SECOND FLOOR SECTION PLAN` (1:150):** the second
floor is zoned **LOUNGE BAR · WORKING SPACE · BoH · SHISHA · ELECTRICAL ·
CIRCULATION · SIDE ENTRANCE · VOID**, on grid A–H, overall 24800 × 25870 mm,
FFL +3.390 (circulation +3.370).

The Liquid Station is not a separate room — it sits **inside the LOUNGE BAR zone**.
That is the name to use when asking for the remaining sheets, and it also explains
the fixture: 8100 × 3000 is the station's working footprint around a bar counter
inside a larger hall, not a room contour.

Nothing was extracted from these four files. They dimension the building shell and
the façade; none of them draws a counter, a worktop, a sink or rear equipment, and
`AD01` is at 1:150 without interior joinery. Reading a station set-out off them
would be inference, which the policy below forbids.

## 2026-08-07 — `A01-312 TENANT 12 LAYOUT` 1:30 received. It contradicts the owner lock.

`Kora Food Hall - 1st Floor - Tenants Layout.pdf` p13 is the set-out sheet asked
for: `A01-312 TENANT 12 LAYOUT`, **scale 1:30**, `± 0.000`, undated (`xx 2026`).
Its dimension chains close exactly, so these are stated values, not readings:

- horizontal **8090** = 3350 + 600 + 230 + 340 + 3570
- vertical **2615** = 1520 + 1095 (left) = 1290 + 230 + 1095 (right)

At high magnification the `230` element resolves to a **free-standing concrete
column** (aggregate hatch), and the `600` to an **unbuilt gap in the rear wall**
immediately left of it.

### Drawing versus fixture

| | `A01-312` (1:30) | Fixture (`owner-lock://selena/2026-08-04`) | Δ |
|---|---|---|---|
| Width | **8090** | 8100 | 10 |
| Depth | **2615** | 3000 | **385** |
| Column section | **230 × 230** | 250 × 250 | 20 |
| Column centre X | **4065** (face at 3950) | 3835 | **230** |
| Column centre Y | **1405** (face at 1290 from rear) | 1125 | **280** |
| Rear opening | **600 wide**, at 3350–3950 | door 1200 wide, at 3235–4435 | **600** |
| Left side | wall with a step at Y = 1520 | 1500 open / 1500 wall | — |
| Right side | wall with embedded columns | continuous, no opening | consistent |

Every geometric value differs. This is not a rounding question and it is not the
45 mm artefact reported yesterday from the 1:200 sheet — that reading is now
superseded by the 1:30 chain of 8090.

### The question only the owner can answer

The fixture's variant is literally `variant.kora.owner-intent`, status `review`,
sourced from an owner lock rather than a drawing. So there are two readings, and
they call for opposite actions:

1. **`A01-312` is the existing unit, and the owner lock is the intended redesign.**
   Then both are correct, nothing is wrong, and the fixture needs a second variant
   carrying the as-built — not an overwrite.
2. **The owner lock is recollection and `A01-312` is authoritative.** Then the
   fixture's geometry is replaced with the drawing's, the owner-lock rows in
   `kora-survey-holds.test.ts` are rewritten in the same commit, and LS-AT-002,
   013, 014, 015 close on drawing provenance.

**Which is it?** Nothing has been changed pending that answer. Overwriting an
explicit owner lock on the strength of an undated sheet would be exactly the kind
of silent promotion this document exists to prevent.

One reconciliation worth checking rather than assuming: `A01-312` draws an
additional strip in front of the unit, across the full 8090, outside the 2615
chain. If that strip is ~385 mm, the owner's 3000 may be "unit + counter strip"
measured to a different boundary. The strip is not dimensioned on this sheet, so
this stays a hypothesis.

### `LS-AT-012` is untouched by this sheet

All 13 tenant sheets (`A01-301`…`A01-313`) are plans. There is no section through
Tenant 12 anywhere in the package, so clear height remains fully open.

### CONFIRMED 2026-08-07 by the owner: **Liquid Station = TENANT 12**, 1st floor

Identity is settled. It is drawn on `A01-201 FIRST FLOOR PLAN` (1:200), south-east
of the tenant block beside the side-entrance stair.

**The drawing corroborates the owner-intent topology.** At high magnification the
unit shows, and all of it matches the fixture built on 2026-08-04:

| Seen on `A01-201` | Fixture |
|---|---|
| double-leaf door centred in the rear wall | `opening.kora.rear-door`, `handing: "double"` |
| free-standing square column inside the unit, on roughly the door axis | `column.kora.center`, door centred at X = 3835 |
| counter run along the open south side facing 8 stools | `object.kora.counter`, guest counter |
| two sink positions in the counter run (one appears double-bowl) | the pending central sink, `LS-AT-015` |
| unit open to the seating area on the south side, no wall | why the 3000 "depth" is a working footprint, not a room |

This is qualitative corroboration of the model, not measurement. It is recorded
here and **not** written into the fixture: the fixture's `metadata` feeds the
semantic hash, and the published browser evidence is bound to
`12a989ef19237987f1c4cf64e491fe0393f4baad1af10c79436828ce220b4267`.

**The one numeric conflict to resolve.** The bottom dimension chain on `A01-201`
brackets Tenant 12 between two extension ticks as **3260 + 760 + 4035 = 8055 mm**,
against the owner-locked **8100 mm**. Both ticks appear to sit on the inner wall
faces, so this is not obviously a grid-versus-face difference. 45 mm is small but
it is the difference between a measured value and a remembered one, and the module
treats owner-locked geometry as immutable — `kora-survey-holds.test.ts` fails if
`8100` drifts. **Only the drawing author or a site check can say which is right.**
Nothing was changed on the strength of a 1:200 sheet.

Tenant 12's depth is not dimensioned on this sheet at all — its south side is the
open counter line, not a wall, so there is no extension line to read.

### Superseded: the earlier Lounge Bar reading

The previous entry inferred, from zone naming alone, that the station sits in the
2nd-floor LOUNGE BAR. Five 1st-floor sheets supplied on 2026-08-07 point elsewhere
and to a stronger source.

| Supplied | What it is | Bearing on the open rows |
|---|---|---|
| `A01 - Layout & Seating Layout 6.pdf` → `A01-201 FIRST FLOOR PLAN` 1:200 | whole ground floor: **TENANT 01–13**, seating, two SERVICE STATIONs, staff/BoH, ±0.000 | **locates TENANT 12** |
| `MEP Progress 1.1.pdf` → `P02-101 CLEAN WATER SCHEMATIC`, NTS | riser schematic listing **"TENANT 12 SINK"** alongside tenants 1–13 | confirms Tenant 12 has a sink; no set-out (NTS) |
| `A01 - Public Toilet.pdf` (`A01-202`) | 1st-floor public toilet | none |
| `A05 - AC Room, Canopy, Door & Window Rev 1.1.pdf` (17 sheets, `A02-1xx/2xx`) | AC room, canopy, doors and windows | none |
| `AD01 - Planter Box.pdf` (`AD01-101/201`) | 1st-floor planter box | none |

`KORA_COORDINATE_FREEZE.md` already named the missing input as *"exact Tenant 12
contour and clear height"* — consistent with the owner confirmation above. The
earlier reading that placed the station in the 2nd-floor LOUNGE BAR was inferred
from zone naming alone and is withdrawn.

**Why no row closes even with the identity settled.** Row by row, against
`A01-201` (1:200) and `P02-101` (NTS), the only two sheets that show Tenant 12:

| Row | What the sheets give | What is missing |
|---|---|---|
| LS-AT-012 clear height | nothing — no section through Tenant 12 | the whole value |
| LS-AT-013 door | confirms double-leaf swing | height, frame, structural-vs-clear width |
| LS-AT-002 column axis | column is visible | no dimension line ties it to any wall face |
| LS-AT-014 rear equipment | one hatched item visible | no dimensions, no schedule |
| LS-AT-015 central sink | sink symbols visible; `P02-101` lists "TENANT 12 SINK" | no position, no size; `P02-101` is `NTS` |

Zero of five. A 1:200 plan is not a set-out for a 250 mm column or a 1200 mm door,
and reading one proportionally is what the policy at the end of this document
forbids.

### What is still needed, now named precisely

**The fit-out sheet for TENANT 12 at 1:50 or 1:25** — an enlarged tenant plan with
its own section. In this project's numbering that lives under `VIII Details` as an
`AD`/`ID` sheet for the tenant, exactly as `AD01 Planter Box` and `AD06 Service
Area` are for their scopes. It should carry the unit contour, the column tie-in,
the door, the counter and work surface, the central sink and the rear equipment.

One sentence of confirmation would also help and costs nothing: **is the "Liquid
Station" Tenant 12?** If it is something else, name it and the search narrows
immediately.

Failing the fit-out sheet, in order of usefulness:

1. The **project drawing list** (the equivalent of p11 in the toilet package) — one
   page naming every sheet; the right one can then be requested by code.
2. Any **enlarged tenant plan** at 1:50 covering the Tenant 10–12 row.
3. `План_2-го_этажа_структурный.png` / the structural ground-floor equivalent —
   for the column tie-in (LS-AT-002).
4. `Разрез_здания.png` — for clear height (LS-AT-012).
5. The drawing-list XLSX inside `DWG - Restaurant Second Floor.rar`.

### Fastest path

Send the five `local` files first — they are on the machine right now:

1. `Kora Food Hall - 2nd Floor - AD06 - Service Area.pdf`
2. `План_2-го_этажа_1-100.pdf`
3. `План_2-го_этажа_структурный.png`
4. `Kora Food Hall - 2nd Floor - A05 - Doors & Windows Rev 2.pdf`
5. `Разрез_здания.png`

If the Liquid Station is dimensioned on those sheets, all five rows close with no
site visit and no new survey.

## Alternative delivery: the same drawing package, for the Liquid Station

The owner supplied *ODE Ubud Foodhall — 2nd Floor Toilet, Final Design,
17 September 2025* (58 sheets, Nitro Pro). It was reviewed in full: text layer and
floor/section sheets. It covers the 2nd-floor toilets only — plan 5510 × 4980 mm,
grid A–E / 01–05, male/female toilet, circulation, planter, bench, stair. There is
no Liquid Station sheet and no whole-floor key plan, and no occurrence of
`liquid`, `bar`, `beverage`, `counter` or `kitchen` anywhere in the document.
**It therefore closes none of the rows below**, and none of its values (`+2.540`,
`+2.750`, `FFL ±0.000`, existing beams) may be carried across to another room.

What it does establish is the deliverable standard. The fastest way to close every
row is the equivalent package for the Liquid Station, in the same series:

| Row | Input needed | Sheet type in the ODE series |
|---|---|---|
| LS-AT-002 | column centre tied to two finished wall faces | Floor Plan with dimension strings + grid (`A01-101`) |
| LS-AT-012 | clear height, and lowest obstruction if different | Section Plan (`A02-101`) + Ceiling Plan (`A03-201`) |
| LS-AT-013 | door height, frame, leaf/swing | Door & Partition Plan + Door details (`A03-101`, `A03-201…203`) |
| LS-AT-014 | rear equipment set-out | Floor Plan + Details (`AD/ID 01-1xx`) |
| LS-AT-015 | central sink set-out | equivalent of "Washbasin Layout & Section" (`ID01-101/102`) |

If those sheets already exist, sending them is sufficient — no site visit needed.
If they do not, the field list in sections 1–5 above is the minimum to measure.

## How to deliver

Either the sheets above, or a table (any format) with the fields in sections 1–5,
plus who measured and when. Once it lands,
`fixtures/layout-studio/kora-liquid-station.v0.1.json` gains the values, the
corresponding warning codes are removed, and
`tests/layout-studio/domain/kora-survey-holds.test.ts` is updated in the same
commit so the removed hold cannot be silently reintroduced.

## What must not happen

No coordinate may be taken from a rendering, a photograph, an AI estimate or a
proportional reading of a perspective image. A hold stays open until a measured
value replaces it.
