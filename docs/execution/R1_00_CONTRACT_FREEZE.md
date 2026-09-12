# INT-R1-00 — contract freeze

Status: `IN_PROGRESS`.

## Frozen integration boundaries

- Existing request-bound command, live-read and action-registry paths remain the sole shared command boundaries.
- Existing private source storage and release-artifact workers are reused where their contracts apply; R1 adds no public asset paths.
- R1 external representations are reviewable before M3 handoff but cannot create a release without existing native layout, approved selections and budget prerequisites.
- DWG parsing is a later gated package; R1-08B stays blocked pending an approved real DWG corpus. This does not block 01–07, 08A, 09–12.

## Dependency queue

1. `R1-01` identities and versions.
2. Wave A after 01 contract: `R1-02` direct upload, `R1-03` AV/safe workers, `R1-04` private delivery.
3. Wave B: `R1-05` representations, `R1-06` viewer, `R1-07` object links, `R1-11` lifecycle.
4. Wave C: `R1-08A` technical links/PDF, `R1-09` review, `R1-10` M3 release.
5. `R1-08B` only after the real-DWG gate; then `R1-12` regression and `R1-13` real pilot.

## Known blockers

- `R1-08B`: real allowed DWG corpus and visual-fidelity gate are absent.
- Live clone rehearsal: browser-control is `BLOCKED_EXTERNAL`; it does not block R1 repository packages.
