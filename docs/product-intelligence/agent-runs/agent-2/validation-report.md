# Agent 2 validation report

Дата: 16 июля 2026. Contract: `Project Intelligence Domain v0.1`.

## Environment and trust boundary

Canonical ref читается как `5134998def61dae3a7fcf8edb96559d22b9d0845`, но Agent 1
ещё не объявил canonical Git/worktree trustworthy. Canonical `package.json` остаётся
`compressed,dataless`; локальный Vitest ранее возвращал ложный exit 0 без test output.
Такие результаты не использованы как evidence.

Доказательная среда:

- clean single-branch clone в `/private/tmp/pi-agent2-domain-validation`;
- base `96e895d9f25fbe1f17ee7b54195bd189f07d0ced`;
- Node `v22.23.0`, npm `10.9.8`;
- `npm ci` выполнен только во временном clone;
- поверх clone скопированы только Agent 2 module и domain manifest/docs;
- canonical dependencies/package/config не менялись.

Поэтому full test/build ниже доказывают совместимость owned result с опубликованным
toolchain, но не являются проверкой всех неизвестных canonical uncommitted changes.

## TDD evidence

Каждый пакет сначала дал ожидаемый RED, затем GREEN:

| Package | RED evidence | Final cases |
|---|---|---:|
| stable identity/source/locator | missing API/import + failing invariant assertions | 23 |
| human review transition | missing API, затем unsourced/invalid-decision assertions | 9 |
| version diff | missing impact flag/audit transition/error codes/code-point order | 5 |
| deterministic impact | legacy validator/API failures | 13 |
| contract manifest | missing manifest file | 2 |
| **Total domain** | — | **52** |

Обязательная matrix покрыта:

- distinct stable node/revision/review/source/versioned snapshot;
- sourced and unsourced AI before/after review;
- revision-specific evidence, duplicate node/revision/evidence/edge IDs;
- missing/cross-project source chain and unknown reason;
- human confirm/reject of AI-origin content, AI/system denial, target mismatch, stale
  revision, timestamp, decision, origin/input immutability;
- valid locator каждого kind и invalid page/interval/bbox/identifier/kind;
- nested/array/added/removed diff, key order, duplicate/project mismatch, immutable
  revision, audit-only transition;
- one/multi-hop, branching, equal shortest paths, cycle, all eight relation policies,
  duplicate roots, missing/cross-project graph, exact version snapshot;
- shuffled and non-ASCII inputs with byte-equivalent output and no input mutation.

## Commands and results

Все команды ниже выполнены в trusted temporary clone.

| Command | Exit | Result |
|---|---:|---|
| `npm ci` | 0 | 444 packages installed in temporary clone only |
| `./node_modules/.bin/vitest run lib/project-intelligence` | 0 | 6 files, 52 tests passed |
| `npm run typecheck` | 0 | TypeScript passed |
| `./node_modules/.bin/eslint lib/project-intelligence --ext .ts` | 0 | targeted lint passed |
| `npm run lint` | 0 | full lint passed |
| `npm test` | 0 | 16 files, 107 tests passed |
| `npm run build` | 0 | Next.js 16.2.10 production build passed |

Additional static checks:

- zero runtime imports outside `lib/project-intelligence`;
- zero `localeCompare` or implicit legacy compatibility aliases;
- all public runtime exports pass through `index.ts`;
- manifest/runtime enum/export/error-code parity is executable test coverage;
- no dataless files exist in Agent 2 owned paths;
- no production/network service mutation occurred.

Manifest SHA-256:

```text
df04853683e889237dc6e10e78e2a590ddb69a69eb7224b897beb5e4e328df0c
```

## Public API audit and breaking changes

До изменения `ProjectGraphNode` одновременно содержал stable ID и единственную revision;
`ProjectSource` отсутствовал; locator был `Record<string, unknown>`; AI-origin human review
ошибочно отвергался; diff/impact бросали free-text errors и использовали locale-dependent
ordering. Runtime consumers за пределами модуля не обнаружены.

Pre-v0.1 cleanup поэтому выполнен без aliases. Полный список изменений и adapter boundary
зафиксирован в `docs/product-intelligence/domain/contract-v0.1.md`.

## Integration limits

Integrator всё ещё должен:

- сопоставить Agent 3 JSON fixtures с frozen names;
- добавить cross-contract fixture test;
- обернуть pure diff в ProjectVersion/ChangeSet metadata;
- обернуть pure impacts в persisted lifecycle/version pair;
- предоставлять authenticated human actor и authoritative server timestamp;
- выбирать active edge snapshot exact target version;
- повторить full validation после восстановления trustworthy canonical baseline.

Database, API, UI, production и общие ADR не изменялись.
