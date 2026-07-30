# RU ProUp vertical-slice validation

`fixture_ready=true` — 2026-07-16

The fixture and golden test cover the contract sequence:

`design package import → baseline → room/trade WBS → RUB estimate → procurement state → change order → mobile/photo report → RU handoff`.

The test is deliberately an application-contract fixture. It does not claim that the corresponding persistence/API screens already exist.

## Gaps exposed

- The fixture is not yet connected to DB2 relations or a ProUp command API.
- Procurement and photo-report persistence need a migration/API owner before implementation.
- The golden hash covers logical content only; object-storage bytes and signed URLs are excluded.
- A real pilot still requires two live RU projects from one company.
