# Project Intelligence Wave 1 — integration report

Дата приёмки: 16 июля 2026 года.

## Итоговое решение

```text
SNAPSHOT_GATE=passed
DOMAIN_CONTRACT_V0_1=accepted
VERTICAL_CONTRACT_AND_FIXTURES=accepted
CROSS_CONTRACT_GATE=passed
BASELINE_READY=false
DATABASE_CHANGES_ALLOWED=false
PRODUCTION_CHANGED=false
```

Pure domain, contract documents и synthetic fixtures этой волны приняты. Persistence,
application/UI integration, восстановление рабочих migrations, commit/push и production
rollout не разрешены: Git/worktree и authoritative production migration ledger остаются
недостоверными.

## Gate 0 — исходный snapshot

- `snapshot_captured: true` был записан Agent 1 до первой записи Agent 2/3;
- scope hash: `6d6d82221ed157e3f8248af14ad4b6c72573801e454b15ed466658a39577f218`;
- unreadable/dataless files в существующих write scopes Agent 2/3: `0`;
- raw snapshot сохранён вне repo с ограниченными permissions;
- Git state в момент snapshot: `unavailable`, поэтому gate разрешил только изолированные
  owned paths, а не работу с migrations/app.

## Agent outcomes

### Agent 1 — Repository & Migration Integrity

Статус: accepted handoff с `BASELINE_READY=false`.

- 9/9 deliverables существуют и читаются;
- exact proposed `0007` SHA-256:
  `474f49491d60bbb200f8f1723a500b3f2c3b7fe0c4769d5507544c07e73a12cc`;
- proposal совпал byte-for-byte с извлечением local HEAD;
- proposed continuous `0001…0009` прошёл disposable PostgreSQL 16 bootstrap;
- 13/13 ожидаемых tables созданы, RLS включён, ожидаемые constraints/indexes/functions
  присутствуют;
- production не изменялась; actual `supabase/migrations/0007_project_rooms.sql` не
  восстанавливался.

Blocking evidence:

- 62 dataless Git metadata files, включая index/pack;
- 76 dataless source/config candidates;
- `git status`, `diff`, `fsck` завершаются exit `138`;
- worktree `0007` отсутствует, `0008` dataless/unhashed;
- authoritative migration ledger не получен;
- production `0007` schema-equivalent shape видна, `0009` hardening shape не видна, но
  exact applied migration state остаётся unknown без ledger;
- high security blockers: client-supplied actor authority в task RPC, plaintext
  non-expiring bearer tokens и mutable/cascade audit history.

### Agent 2 — Project Graph Domain Core

Статус: accepted frozen candidate `0.1`.

- stable node, immutable revision, source, evidence, human review и exact version graph
  snapshot разделены;
- AI-origin revision может быть подтверждена отдельным human review без потери origin;
- source locator имеет runtime validation для шести kinds;
- diff и impact возвращают stable structured errors и Unicode code-point ordering;
- review-only revision transition не создаёт impact root;
- change-impact детерминирован, cycle-safe и использует shortest stable path;
- manifest SHA-256:
  `df04853683e889237dc6e10e78e2a590ddb69a69eb7224b897beb5e4e328df0c`.

Agent 2 validation в trusted clean clone: 52/52 targeted и 107/107 full tests, typecheck,
targeted/full lint и build passed до добавления интеграционного теста.

### Agent 3 — Vertical Slice Contracts & Fixtures

Статус: accepted.

- 7 contract documents;
- 17 JSON fixtures, 3 synthetic sources, 3 fragments;
- V1→V2 diff: только decision `/material`;
- impacts: Item distance 1, Budget и Finish Schedule distance 2;
- non-propagating Risk исключён;
- 9 negative cases;
- stable semantic handoff hash;
- standalone validator и privacy scan passed;
- fixture manifest SHA-256:
  `42510007531046125a39aab85c61decca915fe8ffa12ea4ae385cd6551231e2e`.

L0 отмечен executable, L1 contract-ready, L2 persistence/RLS/idempotency/job store/real
renderer честно deferred.

## File ownership audit

Списки `files_changed` из трёх STATUS-файлов проверены машинно:

```text
Agent 1: 9 files
Agent 2: 19 files
Agent 3: 27 files
overlap: none
```

Рабочие migrations, app routes/components, package/config files и production не менялись.
Git add/commit/push не выполнялись.

## Cross-contract Gate I4

Integrator создал единственный adapter/test:

```text
tests/project-intelligence/vertical-slice-contract.integration.test.ts
```

SHA-256:
`5a2891c13365d6829dc61f35d9cc6c4c3385c1ffaab95ddefeb8f35822bf6c03`.

Шесть интеграционных cases доказывают:

1. graph V1/V2 fixtures отображаются в frozen `ProjectGraphSnapshot` и проходят все
   invariants;
2. human review AI-origin revision сохраняет `origin=ai` и exact target revision;
3. calculated diff совпадает с golden `/material`;
4. `changedNodeIds` создаёт один root, а calculated impacts точно совпадают с тремя
   golden paths;
5. reverse input ordering не меняет result, `conflicts_with` Risk не propagates;
6. unsourced AI, unknown without reason, non-human review, stale review и cross-project
   edge отображаются в stable domain codes; cycle завершается; application-only evidence,
   change-reason и idempotency errors остаются за пределами pure domain.

Accepted adapter decisions:

- fixture `human_confirmed` отображается как base revision status + separate HumanReview;
- fixture `contentOrigin` отображается в domain `origin` без переписывания lineage;
- questionnaire structured locator временно отображается в фиксированный `plain_text`
  range; richer locator остаётся application projection;
- ChangeSet actor/time/reason и persisted impact lifecycle оборачивают pure result;
- перед impact caller обязан выбрать edges, активные для exact target version.

## Integrator verification

Доказательная среда: `/private/tmp/pi-agent2-domain-validation`, clean remote base
`96e895d9f25fbe1f17ee7b54195bd189f07d0ced` + только принятые Agent 2/3 файлы и
Integrator test. Это не объявляется проверкой неизвестного canonical dirty state.

| Command | Result |
|---|---|
| `node fixtures/project-intelligence/kitchen-worktop/validate.mjs` | passed |
| integration test only | 1 file, 6/6 passed |
| domain + integration targeted | 7 files, 58/58 passed |
| `npm run typecheck` | passed |
| targeted ESLint | passed |
| `npm run lint` | passed |
| `npm test` | 17 files, 113/113 passed |
| `npm run build` | passed, Next.js 16.2.10 |
| `npm audit --omit=dev` | 0 vulnerabilities |

## Разрешённое и заблокированное продолжение

Принято и может оставаться в текущем workspace:

- pure `lib/project-intelligence/**`;
- domain manifest/docs;
- vertical-slice contracts/fixtures;
- Integrator cross-contract test;
- Agent reports.

Заблокировано:

- любое изменение `supabase/migrations/**`;
- persistence/RLS/API/UI implementation нового Project Graph;
- восстановление `0007` в worktree без доказанного Git dirty state;
- применение `0009` или другой migration к production;
- commit/push/merge из недостоверного canonical checkout.

Следующий обязательный gate:

```text
NEXT = PI-001 + PI-002
```

Нужно полностью материализовать существующий iCloud repository, повторить Git integrity,
получить approved read-only production migration ledger и сопоставить его со schema-only
evidence. Только после `BASELINE_READY=true` можно проектировать/принимать additive
PI-011/PI-012/PI-020/PI-030 persistence wave.

## Explicit production statement

```text
Production changed: NO
Production data/PII read: NO
Production migration applied: NO
Deploy performed: NO
Git commit/push performed: NO
```
