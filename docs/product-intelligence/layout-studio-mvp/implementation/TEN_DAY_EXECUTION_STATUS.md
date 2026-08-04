# ArchiDom Layout Studio — 10-day execution status

Date: 2026-08-04
Branch: `codex/archidom-layout-studio-m2`
Mode: autonomous agent loop

This tracker follows `06_EXECUTION_PLAN_10_DAYS.md` literally. A day is complete only
when its output and evidence exist. Synthetic evidence never substitutes for the
authoritative KORA coordinate gate.

| Day | Required outcome | Status | Current evidence / next action |
|---:|---|---|---|
| 1 | Gate 0, contract, fixture skeleton | PARTIAL | Baseline, dependency and synthetic fixture green. KORA coordinate freeze blocked. |
| 2 | Domain, commands, geometry, hash | PASS | Pure domain tests and derived synthetic projection. |
| 3 | Exact recognizable KORA 2D | BLOCKED | No authoritative plan revision or coordinate table anywhere in supplied package/workspace. Must not invent. |
| 4 | Inspector, locks, undo/redo | PASS | Command engine, editor session, browser shell and automated tests. |
| 5 | One-model 2D→3D | PASS_SYNTHETIC | WebGL scene derives from the same document; KORA-specific gate remains blocked. |
| 6 | Materials, lights, legibility | PASS_SYNTHETIC | Canonical material assignments and light descriptors drive the 3D scene by stable target ID. |
| 7 | Persistence and versions | PASS | Browser repository, autosave/reload, checkpoints, immutable versions, diff and quota handling. |
| 8 | Exact-version export pack | PASS_SYNTHETIC | Exact immutable version feeds JSON/SVG/GLB/print; manifest checksum, warnings and privacy gate are tested. PNG remains a browser rasterization convenience. |
| 9 | Integration and defect burn-down | PASS_SYNTHETIC | Dynamic flag-off route, keyboard controls, browser smoke, 75/75 module tests and full regression pass. KORA assertions remain blocked. |
| 10 | Freeze, verification, performance, decision | COMPLETE_WITH_BLOCKER | Verification, performance and final gate reports exist. Decision: synthetic technical MVP green; KORA beta NO-GO pending coordinates. |

## Hard blocker: Day 3 / LS-040

Missing authoritative inputs:

- exact Tenant 12 contour and origin/axes;
- clear height;
- door parent walls, offsets and dimensions;
- column X/Y and height;
- sink coordinates/dimensions;
- verified equipment schedule/positions;
- resolved EQ-04 height;
- anchors for the stated 3000 mm distance;
- owner-approved stable-ID coordinate table.

Until supplied, `fixtures/layout-studio/liquid-station.synthetic.v0.1.json` remains a
technical demo only. It cannot be renamed to `kora-liquid-station.v0.1.json` or counted
as LS-AT-010..016 evidence.

## Autonomous closeout completed

- 70 test files / 403 tests pass across the repository; Layout Studio is 75/75.
- lint has zero errors (nine inherited warnings), typecheck and production build pass.
- deterministic GLB 2.0, exact-version manifests and privacy checks pass.
- performance measurements and terminal decision are recorded in sibling reports.

## Terminal condition

The autonomous loop may close all non-KORA work. Final status must remain
`PARTIAL/BLOCKED_KORA_COORDINATE_GATE`, not `PRODUCTION_READY`, until Day 3 receives
authoritative coordinates and is rerun through Days 3, 5, 8, 9 and 10.
