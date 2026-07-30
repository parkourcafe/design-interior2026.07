# Vertical Slice Contract v0.1

Статус: **proposal for integration**, не runtime implementation.

Этот пакет фиксирует первый общий вертикальный срез Project Intelligence Core: источники и provenance, human review конкретной revision, immutable V1/V2, детерминированный impact и логический handoff. Route names и UI composition остаются proposed; semantics, stable error codes и fixture expectations предназначены для проверки Integrator.

## Состав

- [use-case.md](./use-case.md) — actors, happy/alternative paths, retries и postconditions;
- [api-contract.md](./api-contract.md) — proposed operations, schemas, roles, concurrency и errors;
- [ui-state-machine.md](./ui-state-machine.md) — P0 states без visual design;
- [events.md](./events.md) — разделённые audit/product events;
- [traceability.md](./traceability.md) — связь acceptance criteria с API, UI и fixtures;
- [contract-gaps.md](./contract-gaps.md) — assumptions, deferred и cross-contract вопросы;
- `fixtures/project-intelligence/kitchen-worktop/` — synthetic golden fixture pack.

## Канонические правила

1. `contentOrigin` описывает происхождение содержания revision. Review actor хранится отдельно и не меняет AI provenance.
2. Human review всегда адресует `targetRevisionId`; actor ID/role и timestamp определяются сервером.
3. Stable decision node не меняется между V1 и V2; изменение создаёт `revision-decision-worktop-material-r2`.
4. Semantic diff V1 → V2 содержит только `/material`.
5. Impact вычисляется только по сохранённым version-active edges и не принимает client-supplied graph.
6. `conflicts_with` не распространяет impact.
7. Accepted impact считается рассмотренным, но остаётся unresolved до `resolved` или `not_applicable`.
8. Handoff hash вычисляется по canonical `logicalContent`; job metadata не входит в hash.

## Maturity

- `L0 executable now` — проверяется standalone validator без runtime/DB;
- `L1 contract ready` — semantics готовы для application/API adapter;
- `L2 deferred` — требует persistence, RLS, idempotency store или real renderer.

L2 не считается пройденным этим пакетом.

## Проверка

```text
node fixtures/project-intelligence/kitchen-worktop/validate.mjs
```

Validator использует только Node built-ins, не импортирует `lib/project-intelligence` и не требует установки пакетов. Cross-contract adapter создаёт только Integrator после freeze public domain contract.

## Границы

Пакет не создаёт API routes, UI components, SQL, migrations, production export, Studio/ProUp-specific journey, procurement, billing или CAD/3D.
