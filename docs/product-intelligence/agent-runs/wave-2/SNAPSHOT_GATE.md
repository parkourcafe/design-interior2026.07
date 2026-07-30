# Wave 2 snapshot gate

Captured: 16 July 2026, before any Agent 1/2/3 write.
Decision: **PASSED for the exclusive Wave 2 paths below**.

## Scope state at capture

| Owner | Exclusive path | Pre-existing files |
|---|---|---:|
| Agent 1 | `tests/project-intelligence/application/architecture/**` | 0 |
| Agent 1 | `docs/product-intelligence/agent-runs/wave-2/agent-1/**` | 0 |
| Agent 2 | `lib/project-intelligence/application/workflow/**` | 0 |
| Agent 2 | `docs/product-intelligence/agent-runs/wave-2/agent-2/**` | 0 |
| Agent 3 | `lib/project-intelligence/application/change-handoff/**` | 0 |
| Agent 3 | `docs/product-intelligence/agent-runs/wave-2/agent-3/**` | 0 |

The three ownership sets are pairwise disjoint. Common application index, root public
export and root integration test are Integrator-only and did not exist at capture.

## Frozen input fingerprint

The sorted `SHA-256 + two spaces + relative path` lines for the following readable sets
were hashed again with SHA-256:

- existing `lib/project-intelligence/**`;
- domain and vertical-slice contract docs;
- all kitchen-worktop synthetic fixtures;
- Wave 1 cross-contract integration test;
- Architecture v1, L1 spec and Wave 2 task specs.

```text
FROZEN_INPUT_AGGREGATE_SHA256=73bec18122badb492dc989904978e4ff9962ca063359f1e6a4d3483720e67eec
FROZEN_INPUT_READ_ERRORS=0
OWNED_PATH_OVERLAP=0
```

Key fixed artifacts:

```text
architecture-v1.md                 3d99459edde8aa212dae8d7cba97747a2c3b110d4062014c2c2d8469deab551d
vertical-slice-l1-spec.md           802eb3c27a62e8e67d414ca942a7cfa8ca9e29582c981f9d35d266a26a03a1a4
domain/contract-v0.1.json           df04853683e889237dc6e10e78e2a590ddb69a69eb7224b897beb5e4e328df0c
kitchen-worktop/manifest.json       42510007531046125a39aab85c61decca915fe8ffa12ea4ae385cd6551231e2e
Wave 1 integration test             5a2891c13365d6829dc61f35d9cc6c4c3385c1ffaab95ddefeb8f35822bf6c03
```

Agent 1 will create the complete machine-readable per-file manifest independently.

## Boundary of this pass

This gate authorizes writes only to the isolated Wave 2 paths. It does not establish a
trustworthy canonical Git dirty state and does not change the prior decisions:

```text
BASELINE_READY=false
DATABASE_CHANGES_ALLOWED=false
PRODUCTION_CHANGES_ALLOWED=false
MIGRATIONS_ALLOWED=false
GIT_COMMIT_PUSH_ALLOWED=false
```

No database, production data or external provider was accessed to capture this gate.
