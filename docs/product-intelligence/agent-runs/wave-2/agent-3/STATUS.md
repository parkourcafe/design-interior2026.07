# Wave 2 Agent 3 — Change Impact & Logical Handoff

```text
STATUS=accepted_candidate
SNAPSHOT_GATE=passed
FROZEN_INPUT_AGGREGATE_SHA256=73bec18122badb492dc989904978e4ff9962ca063359f1e6a4d3483720e67eec
TARGET_GRAPH_DIGEST_SHA256=b962aeb9298e6204f8ea63d0fdd8276ccccc302cc504c76aa469d999be554ae0
IMPACT_RESULT_DIGEST_SHA256=9b8d15a43c282f677d668b3dcad87072f5058773d73b24b2ea435c44d19e5ced
TARGETED_TESTS=33/33_passed
FULL_TESTS=171/171_passed
TYPECHECK=passed
LINT=passed
BUILD=passed
PASS2_SECURITY_PROBES=passed
BLOCKERS=none
L2_DURABILITY_CLAIM=false
```

## Outcome

Owned application boundary реализует полный L1 путь:

```text
published V1/V2
  → frozen semantic diff
  → internally derived roots
  → frozen deterministic impact traversal
  → immutable human impact reviews
  → deterministic logical handoff + computed semantic SHA-256
```

`ChangeHandoffApplicationService` возвращает pure transition: logical result, immutable
`nextState`, replay flag и controlled audit intents. Owning port обязан атомарно commit-ить
state transition, idempotency record и audit intents. Модуль не содержит repository,
in-memory production adapter, DB/storage/API/job/renderer и не утверждает cross-process
durability.

Golden fixture воспроизведён вычислением:

```text
logicalContent = exact expected-handoff.json logicalContent
semanticContentHash = sha256:9c7d1eddd1278bda3308fc8c41b20908ee3f600e08848b49a910484fb3e8484b
```

Hash не hardcoded в implementation. Он вычисляется как SHA-256 от UTF-8 canonical JSON.

Pass 2 закрыл пять runtime/integrity gaps:

- forged actor type, capability, impact status и disposition отвергаются runtime allowlist;
- review reason с free-form/PII не проходит `IMPACT_REASON_CODES` и не попадает в audit;
- `ImpactRun` хранит normalized full `ChangeContext` и digest exact target graph;
- handoff отвергает mutation source/fragment/evidence и подмену change reason после расчёта;
- canonical JSON отвергает sparse/augmented/accessor arrays вместо shape collision.

Fixture graph/run evidence:

```text
targetGraphDigest = sha256:b962aeb9298e6204f8ea63d0fdd8276ccccc302cc504c76aa469d999be554ae0
resultDigest      = sha256:9b8d15a43c282f677d668b3dcad87072f5058773d73b24b2ea435c44d19e5ced
```

## Changed files

1. `lib/project-intelligence/application/change-handoff/__tests__/support/fixtures.ts`
2. `lib/project-intelligence/application/change-handoff/canonical.test.ts`
3. `lib/project-intelligence/application/change-handoff/canonical.ts`
4. `lib/project-intelligence/application/change-handoff/impact-run.test.ts`
5. `lib/project-intelligence/application/change-handoff/index.ts`
6. `lib/project-intelligence/application/change-handoff/logical-handoff.test.ts`
7. `lib/project-intelligence/application/change-handoff/review-impact.test.ts`
8. `lib/project-intelligence/application/change-handoff/service.ts`
9. `lib/project-intelligence/application/change-handoff/types.ts`
10. `docs/product-intelligence/agent-runs/wave-2/agent-3/STATUS.md`
11. `docs/product-intelligence/agent-runs/wave-2/agent-3/interface-summary.md`
12. `docs/product-intelligence/agent-runs/wave-2/agent-3/validation-report.md`

`__tests__/support/fixtures.ts` — explicit test-only fixture adapter. Он не экспортируется
из public `index.ts`.

Pass-2 изменил files 2–4 и 6–12, кроме `index.ts` и test fixture adapter; полный owned
deliverable по-прежнему состоит из перечисленных 12 files.

## Assumptions and boundaries

- `ApplicationExecutionContext` и `ChangeHandoffIdFactory` создаются trusted server-side;
  command body не назначает actor, organization, project, capability, time или IDs.
- Custom ID factory обязан возвращать стабильный ID для одинаковой semantic identity.
  Default factory выводит ID из computed SHA-256; fixture test factory остаётся test-only.
- `HandoffSourceReferenceProjection` — trusted application projection для richer locator
  и stable reference ID. Evidence/source/fragment identity всё равно проверяется по exact
  target graph; неизвестную ссылку или volatile locator модуль отвергает.
- `accepted` остаётся unresolved; `resolved` и `dismissed` попадают в resolved handoff
  group. `accepted → resolved|dismissed` — явная следующая immutable review transition.
- Canonical request digest исключает `serverTime` и `requestId`; replay возвращает
  первоначальный logical result и не создаёт второй audit intent.
- Review request digest включает exact immutable `ImpactRun`; изменение graph/context
  binding не может быть принято как replay.
- `ProjectGraphSnapshot` на handoff/impact обязан совпадать с exact selected target
  revisions/payloads и calculation-time normalized graph digest; alias `latest` не
  принимается.
- `ReviewImpactCommand.reasonCode` остаётся transport-boundary string для совместимости,
  но до persistence/audit обязательно сужается до exported `ImpactReasonCode`.

## Unresolved findings

Нет contract blocker и нет запроса на shared/frozen change.

Canonical workspace содержит dataless local `node_modules/.bin/vitest`, который ложно
завершается code `0` без запуска тестов. Его результат не засчитан. Runtime validation
выполнена в materialized trusted copy `/private/tmp/pi-agent2-domain-validation` с
копированием только owned Agent 3 files. Integrator должен независимо повторить проверки.

## Explicit state statements

```text
Production changed: NO
Production data/PII read: NO
Production credentials/providers accessed: NO
Migrations changed/applied: NO
Database/schema/RLS changed: NO
Frozen domain changed: NO
Frozen contracts changed: NO
Frozen fixtures changed: NO
Agent 2 scope changed: NO
Common exports/root domain index changed: NO
App/API/UI changed: NO
Package/config/lock files changed: NO
Git add/commit/push/restore/reset performed: NO
Deploy performed: NO
L2 durability passed: NO
```
