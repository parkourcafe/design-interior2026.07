# ArchiDom Layout Studio — continuation workspace

Date: 2026-08-06
Status: IMPLEMENTATION COMPLETE IN LOCAL CONTINUATION; VERIFICATION DEFERRED

## Why this workspace exists

The original worktree and its Git object database were repeatedly evicted by macOS
iCloud/File Provider (`compressed,dataless`). A fully local continuation checkout was
created from the published ArchiDom reference-package branch under `/private/tmp`.
No original files were deleted or overwritten.

## Implemented vertical slice

- frozen JSON Schema copied byte-for-byte from the reference package;
- TypeScript domain aligned with schema;
- AJV 2020 schema validation plus semantic invariants;
- stable IDs, integer millimetres and rotation enum;
- command envelope, replay ledger and idempotency conflict;
- monotonic undo/redo revisions;
- canonical serialization and SHA-256 semantic hash;
- deterministic derive and full root/entity diff;
- local browser and memory repository ports;
- corruption recovery, draft CAS, checkpoint listing/hydration;
- immutable version envelope and parent lineage validation;
- 2D SVG with visible openings, objects, zones and selection;
- Three scene projection with segmented openings and one canonical ceiling;
- readable 3D delivery view and selected-mesh highlight;
- exact-version JSON/SVG/PNG/GLB/print export service;
- hash recheck, schema gate, manifest and privacy gate;
- authenticated, default-off internal M2 route;
- simple-room and KORA owner-intent fixtures;
- owner-approved additive ADR.

## Verification policy

Per owner instruction, tests are deferred until implementation closure. No item is
reported as acceptance PASS until the continuation tree is transferred to the target
branch and the full clean verification/browser/export/security suite is executed.

## Remaining external holds

- surveyed KORA clear height;
- verified absolute column axis/faces;
- door height, frame and swing;
- counter depth;
- conflict-free equipment XY schedule and espresso envelope;
- original branch materialization or an approved transfer mechanism.
