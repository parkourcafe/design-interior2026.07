# ADR-0006 — Native ArchiDom Layout Studio M2 research gate

Date: 2026-08-04  
Status: Accepted for isolated research implementation only

## Decision

Selena, product owner, authorizes development of native ArchiDom Layout Studio as
an isolated M2 module in branch `codex/archidom-layout-studio-m2`.

The module:

- remains default-off;
- does not rename or replace existing `projectceo_*` compatibility contracts;
- does not write to private Product Intelligence tables;
- does not change existing timestamped migrations;
- does not merge to production before 100% P0 acceptance PASS;
- requires a repeat independent audit and a separate owner merge decision.

## Scope

The research vertical slice owns a canonical millimetre LayoutDocument, deterministic
2D/3D projections, local draft/checkpoint/version storage and exact-version export.
It belongs to M2 Approved Design Intent. It does not claim CAD/BIM construction
authority, automated approval, ERP, accounting or marketplace scope.

## Consequences

The current Product Charter delivery sequence is not silently replaced. This ADR is
additive and narrowly authorizes the isolated spike. Production adoption remains a
future controlled gate.
