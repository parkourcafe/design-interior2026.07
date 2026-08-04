# Layout Studio MVP — performance report

Date: 2026-08-04
Scope: synthetic fixture only
Command: `npx tsx scripts/layout-studio/measure-performance.ts`

## Environment

- Apple M4 Pro, 14 logical CPUs, 24 GiB RAM;
- macOS arm64;
- Node.js v22.23.0;
- synthetic fixture: 4 walls, 2 openings, 1 column, 8 objects, 2 lights.

## Results

| Measurement | Iterations | p50 | p95 | max | Target/result |
|---|---:|---:|---:|---:|---|
| Immutable `MOVE_OBJECT` command | 5,000 | 0.0507 ms | 0.0887 ms | 0.9509 ms | <100 ms — PASS |
| Derive + SVG + scene compile, 100 objects | 1,000 | 0.1861 ms | 0.3021 ms | 0.9324 ms | No sustained CPU jank signal — PASS |

Ten headless Three scene build/dispose cycles reported a Node heap delta of 1,766,008
bytes. This number includes lazy module/Three allocation and is not a browser GPU leak
measurement; it is recorded as a signal only and cannot satisfy LS-AT-094 by itself.

## Browser evidence

- Production build rendered the WebGL scene successfully.
- 2D→3D switch completed interactively with no browser console errors.
- Orbit/reset/ceiling controls were present.
- Exact first-useful-frame and ten-switch GPU memory metrics are not exposed by the
  current browser harness and remain manual/P1 evidence.

## Interpretation

The pure command and projection pipeline is far below the MVP interaction budget on
the measured machine. These results do not establish performance for the missing
authoritative KORA geometry, lower-end hardware or production-scale projects.
