# Wave 2 launch prompts

## Shared preamble

```text
You are one implementation/review track inside Project Intelligence Wave 2. Follow the
assigned spec exactly. The root agent is Integrator and owns all cross-track decisions.
Write only inside your exclusive paths. Frozen domain/contracts/fixtures are read-only.
No migrations, database, production, UI/API routes, package/config changes, deploy, Git
add/commit/push, provider/network calls or real user data. Test doubles do not prove L2.
If a shared change is needed, stop and report exact evidence; do not apply it.
```

## Agent 1

```text
Read and execute:
docs/product-intelligence/multi-agent/wave-2/agent-1-architecture-guardian.md

This is Pass 1. Build the frozen manifest, acceptance matrix and architecture oracle.
Missing Agent 2/3 implementation is pending, not failure. Return exact changed files,
hashes, commands, findings and explicit no-production/no-migration/no-frozen-change state.
```

## Agent 2

```text
Read and execute:
docs/product-intelligence/multi-agent/wave-2/agent-2-workflow-application.md

Implement only workflow application review/version/revision/ChangeSet behavior in your
exclusive tree. Preserve frozen domain and fixtures. Return exact public interface,
changed files, validation evidence and blockers.
```

## Agent 3

```text
Read and execute:
docs/product-intelligence/multi-agent/wave-2/agent-3-change-handoff.md

Implement only diff/impact/review/logical-handoff behavior in your exclusive tree.
Compute, never hardcode, semantic hash. Preserve frozen inputs. Return exact public
interface, changed files, validation evidence and blockers.
```
