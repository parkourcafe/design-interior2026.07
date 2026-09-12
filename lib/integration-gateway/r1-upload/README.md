# R1 upload control contracts — bounded implementation evidence

13 September 2026 (Sunday), 02:35 WITA. Base: `1e903d0a13de6c140cd663e3c72a46e467e5614c`; branch `codex/r1-upload-control-contracts`. Local implementation evidence; hosted execution is not established.

Implemented in this directory:

- `contracts.ts`: strict begin/finalize/resume/cancel DTOs, sanitized existing Foundation errors and locator-free projection schema. Browser actor, sourceRole, object locator/hash and unknown properties are rejected. The browser does not supply an object claim; the future trusted adapter inspects the session's object.
- `formats.ts`: exhaustive server classification using existing legacy caps; SKP/DWG original retention is separate from GLB viewable-input and DAE conversion-input profiles. These mappings do not validate native geometry or assert approval.
- `policy.ts`: bounded part ranges and observed complete-part manifests; pure revision/state/expiry checks; necessary fail-closed adapter configuration checks; existing worker attempt limits; measured scan/structure correlation checks.
- `adapters.ts`: internal session/scope, pinned object, validation job and storage interface types for subsequent service/database work. Internal locators and lease secrets must never be used as browser DTOs.
- `contracts.test.ts`, `policy.test.ts`: malicious fields, limits, nonfinite numbers, exact expiry, stale transitions, final safe revision projection, part substitutions, missing capabilities, retry exhaustion and scan/profile/hash mismatch boundaries.

Reuse: `file-intake/policy.ts` supplies existing caps/source-role semantics. `r1-worker/policy.ts` supplies the retry budget and remains the archive/worker policy home; it was not modified or duplicated. Scanner evidence uses the concrete `ClamAvProcessResult` type. Existing Foundation error codes/envelope remain authoritative.

Not implemented: request-bound authorization, route/service wiring, quota reservation, durable idempotency, transactional CAS, leases/outbox, immutable DB lineage, provider storage, real byte detector/scanner execution, production sandbox, delivery, human acceptance or release. In particular, a capability declaration is not proof of storage immutability, a pure state-transition result is not an atomic write, and evidence-shaped test fixtures are not real AV receipts. The future broker must establish the trusted origin of observations, validate scope/receipt identity and enforce all database concurrency and cancellation rules. No policy result grants approval or writes a source.

Verification on the final code before this documentation-only addition (Node v22.23.0):

| Command | Result |
|---|---|
| `npm run lint -- --no-cache lib/integration-gateway/r1-upload` | PASS; invokes repository-wide `eslint .`; 0 errors, 13 existing unused-variable warnings outside this directory |
| `./node_modules/.bin/eslint lib/integration-gateway/r1-upload` after revision boundary fix | PASS, no warnings/errors |
| `npm run typecheck` after revision boundary fix | PASS |
| `npm run test -- lib/integration-gateway/r1-upload lib/integration-gateway/r1-worker lib/integration-gateway/file-intake` | PASS, 9 files / 86 tests |
| `npm run test` | PASS, 219 files / 1,812 tests; separately configured cycle7 gate tests are not part of this command |
| `npm run build -- --webpack` after final code change | PASS, 46 static pages; repository fallback warnings for unset public support/legal display values |

Existing lint warnings occur in `lib/llm/gigachat.ts`, `lib/risks/llm.ts` and four existing test files. Build used the repository's installed Next.js Webpack option with shared installed dependencies, without configuration/credential changes. Database/Auth/storage/browser/real-corpus validation was not run because this slice contains no such implementation. No commit, push, cloud mutation or dependency change was performed by this worker.
