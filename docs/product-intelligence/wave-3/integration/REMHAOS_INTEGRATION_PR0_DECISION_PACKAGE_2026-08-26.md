# RemHaOS Integration Gateway — PR0 Decision Package

**Date:** 2026-08-26 WITA
**Scope:** PR0 only; no code, migrations, routes, flags, credentials, deploys, or production writes.
**Source request:** owner asked Codex to find the technical specification, study it, and work from it.

## Sources Read

- `[ИЗВЛЕЧЕНО]` `/Users/msnigmatullaeva/Downloads/REMHAOS_CODEX_INTEGRATION_EXECUTION_SPEC_2026-08-26.md` is the primary execution specification.
- `[ИЗВЛЕЧЕНО]` `/Users/msnigmatullaeva/Downloads/REMHAOS_CODEX_INTEGRATION_EXECUTION_SPEC_2026-08-26 (1).md` is byte-identical to the primary execution specification.
- `[ИЗВЛЕЧЕНО]` `/Users/msnigmatullaeva/Downloads/COVERAGE.md` reports strict document coverage as 100% (7/7), but explicitly verifies the specification document rather than implementation.
- `[ИЗВЛЕЧЕНО]` Repository-local project rules from `AGENTS.md` state that the active public product is RemHaOS under Product Charter v0.4, while `ProjectCEO` remains an internal compatibility namespace. They also forbid changing old timestamped migrations and require additive changes only.

## Repository State Observed

- `[ИЗВЛЕЧЕНО]` Git toplevel: `/Users/msnigmatullaeva/Documents/designinterior2026/repo`.
- `[ИЗВЛЕЧЕНО]` Current branch: `claude/arhidom-cinematic-website-t2zfdc`.
- `[ИЗВЛЕЧЕНО]` Current HEAD: `9470fceb0912b5546d2d53b297a6a01c8c3d28a8`.
- `[ИЗВЛЕЧЕНО]` Execution spec baseline: `main` / `e014ae0ab29bb58af62b529b3a047ac1506a8148`.
- `[ИЗВЛЕЧЕНО]` The required path `docs/canonical/remhaos-v1/` does not exist in this checkout.
- `[ИЗВЛЕЧЕНО]` No files matching `*REMHAOS*` were found under `docs/canonical`; existing RemHaOS-named files are audit/release documents, not the canonical charter bundle named in the spec.
- `[ИЗВЛЕЧЕНО]` `lib/integration-gateway/` does not exist in this checkout.
- `[ИЗВЛЕЧЕНО]` `app/api/integrations/` does not exist in this checkout.
- `[ИЗВЛЕЧЕНО]` Existing timestamped migrations are present under `supabase/migrations/` and must remain immutable.
- `[ИЗВЛЕЧЕНО]` Full `git status` and broad `git diff` checks were attempted but hung on this local tree; narrow tracked-file listings succeeded.

## PR0 Findings

- `[ИНТЕРПРЕТИРОВАНО]` The execution spec is implementable as a staged Integration Gateway program, but the current request is not the exact gate phrase for PR1.
- `[ИНТЕРПРЕТИРОВАНО]` Code implementation must not start until the repository has the canonical RemHaOS decision bundle required by the spec or the owner explicitly resolves the missing-source conflict.
- `[ИНТЕРПРЕТИРОВАНО]` The current branch/HEAD mismatch against the spec baseline must be consciously accepted before PR1, because it changes the evidence context.
- `[ИНТЕРПРЕТИРОВАНО]` The safe next executable PR is PR1 only after the exact owner gate below is present.

## Required OWNER GO For Next PR

To start code for PR1, the owner must provide this exact gate:

```text
OWNER GO — Integration Registry PR1
```

PR1 would be limited to:

- additive `remhaos_integration` and `remhaos_integration_api` migrations;
- providers, OAuth intents, organization connections, project connections, external objects, import candidates, sync jobs, webhook receipts, and audit events;
- default deny, RLS, explicit grants, and request-bound/system RPCs;
- typed Integration Gateway core interfaces, sanitized errors/logging, and default-off feature flags;
- DB/security/idempotency/concurrency/lease/restart tests required by the spec.

PR1 would not include:

- PR2 project links;
- PR3 file intake wiring;
- PR4 Telegram staging completion;
- PR5 UI/client projection;
- PR6 Google Drive OAuth;
- production credentials, external registration, deploys, or flag enablement.

## Decisions Still Missing Before PR1

- `[ИНТЕРПРЕТИРОВАНО]` Canonical RemHaOS charter, decision log, platform architecture, A7 Telegram addendum, Telegram runbook, readiness matrix, and related ADRs are missing from the required path.
- `[ИНТЕРПРЕТИРОВАНО]` Secret-store policy is not confirmed for this checkout: Supabase Vault vs external secret store/environment contract.
- `[ИНТЕРПРЕТИРОВАНО]` Storage retention/deletion decisions remain explicitly gated before production and should be recorded before file/provider work.
- `[ИНТЕРПРЕТИРОВАНО]` Google Drive data-flow can be drafted from the execution spec, but provider GO and staging credentials are outside PR1.
- `[ИНТЕРПРЕТИРОВАНО]` A clean dirty-tree check is not yet proven because full `git status` hung locally.

## Stop Decision

`[ИНТЕРПРЕТИРОВАНО]` Per execution spec section 25.1, when the required GO is absent Codex must stop with a decision sheet and must not write implementation code. This PR0 package is that decision sheet.
