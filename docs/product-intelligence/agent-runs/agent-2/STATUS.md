---
agent: agent-2
state: complete
baseline_ref: "5134998def61dae3a7fcf8edb96559d22b9d0845 (ref-only; canonical worktree untrusted)"
owned_paths:
  - lib/project-intelligence/**
  - docs/product-intelligence/domain/**
  - docs/product-intelligence/agent-runs/agent-2/**
files_changed:
  - lib/project-intelligence/contract-manifest.test.ts
  - lib/project-intelligence/errors.ts
  - lib/project-intelligence/impact.test.ts
  - lib/project-intelligence/impact.ts
  - lib/project-intelligence/index.ts
  - lib/project-intelligence/invariants.test.ts
  - lib/project-intelligence/invariants.ts
  - lib/project-intelligence/locator.test.ts
  - lib/project-intelligence/locator.ts
  - lib/project-intelligence/ordering.ts
  - lib/project-intelligence/review.test.ts
  - lib/project-intelligence/review.ts
  - lib/project-intelligence/types.ts
  - lib/project-intelligence/version-diff.test.ts
  - lib/project-intelligence/version-diff.ts
  - docs/product-intelligence/domain/contract-v0.1.json
  - docs/product-intelligence/domain/contract-v0.1.md
  - docs/product-intelligence/agent-runs/agent-2/STATUS.md
  - docs/product-intelligence/agent-runs/agent-2/validation-report.md
contract_changes:
  - stable ProjectGraphNode separated from immutable GraphNodeRevision
  - HumanReview targets an exact revision and preserves content origin
  - ProjectSource closes SourceFragment ownership within one project
  - ProjectGraphSnapshot requires an exact versionId
  - locators are a runtime-validated discriminated union
  - diff exposes audit-only revision_transition and impactRelevant
  - impact uses deterministic Unicode code-point shortest-path ordering
  - invalid operations expose stable structured domain codes
validation_commands:
  - npm ci
  - ./node_modules/.bin/vitest run lib/project-intelligence
  - npm run typecheck
  - ./node_modules/.bin/eslint lib/project-intelligence --ext .ts
  - npm run lint
  - npm test
  - npm run build
validation_results:
  - "temporary clean clone base: 96e895d9f25fbe1f17ee7b54195bd189f07d0ced"
  - "targeted: 6 files, 52 tests passed, exit 0"
  - "typecheck: passed, exit 0"
  - "targeted lint: passed, exit 0"
  - "full lint: passed, exit 0"
  - "full tests: 16 files, 107 tests passed, exit 0"
  - "Next.js 16.2.10 build: passed, exit 0"
blockers: []
handoff_ready: true
snapshot_gate_observed: true
snapshot_scope_hash: 6d6d82221ed157e3f8248af14ad4b6c72573801e454b15ed466658a39577f218
domain_contract_ready: true
contract_version: "0.1"
public_api_breaking_changes:
  - ProjectGraphNode is now stable-only; revision/content fields moved to GraphNodeRevision
  - ProjectGraph replaced by versioned ProjectGraphSnapshot
  - ClaimOrigin replaced by ContentOrigin
  - validateProjectGraph replaced by validateProjectGraphSnapshot
  - AI-origin content may be reviewed by a human; only AI/system review actor is forbidden
  - NodeVersionChange adds revision_transition and impactRelevant
  - calculateChangeImpact requires ProjectGraphSnapshot
  - diff and impact invalid inputs use DomainContractError codes
graph_snapshot_versioned: true
source_chain_closed: true
required_integrator_adapters:
  - map Agent 3 fixtures to stable nodes/revisions/reviews/sources snapshot shape
  - wrap pure diff with ProjectVersion and ChangeSet actor/timestamp/reason
  - wrap pure impacts with persisted ID/status/from-to version lifecycle
  - supply authenticated human actor and authoritative server timestamp
  - select edges active for the exact target version
  - implement unavailable-evidence acknowledgement and audit event
targeted_tests: passed
full_tests: passed
typecheck: passed
lint: passed
build: passed
validation_environment: "trusted temporary clone; not full canonical uncommitted HEAD"
production_changed: false
scope_violations: []
---

Domain v0.1 is ready for Integrator Gate I2. The manifest is executable against runtime
constants and exports. Full evidence and the environment limitation are recorded in
`validation-report.md`.
