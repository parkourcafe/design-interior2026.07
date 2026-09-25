# Cloud Code handoff — WP-32 and Aldo 01–07

Date: 2026-09-25 (Asia/Tashkent)
Status: continuation handoff, not a production-release approval.

## Start here

- **ИЗВЛЕЧЕНО:** repository:
  `parkourcafe/design-interior2026.07`; remote
  `https://github.com/parkourcafe/design-interior2026.07.git`.
- **ИЗВЛЕЧЕНО:** branch:
  `codex/wp32-architect-intake-20260923`; HEAD:
  `0fa6da48a458014d4f5523f8a3e6d0fc7589205d`.
- **ИЗВЛЕЧЕНО:** the working tree was clean immediately before this handoff
  file was created. Recheck `git status --short`, full diff, remote, branch,
  HEAD and disk space before any work. Do not reset, stash, overwrite, or
  delete another owner's work.
- **ТРЕБУЕТСЯ:** read the current repository `AGENTS.md`, the Charter and
  Decision Log it names, then
  `docs/audits/wp/WP-32_EVIDENCE.md`,
  `docs/execution/REMHAOS_ALDO_WORKFLOW_ADDITIONAL_TZ_2026-09-24.md`, and
  `docs/product-intelligence/REMHAOS_ALDO_WORKFLOW_ARCHITECTURE_2026-09-24.md`.

## Authority and boundaries

- **ИЗВЛЕЧЕНО:** work was limited to the local disposable Colima profile
  `archidom-ap1-disposable`. Do not use `default`,
  `remhaos-validation`, shared, hosted, or production environments.
- **ТРЕБУЕТСЯ:** do not change production, shared environments, Google Drive,
  Pejeng, original source documents, CI settings, or paid services. Do not
  merge, deploy, create a PR, or modify production configuration without a
  fresh explicit owner approval.
- **ИЗВЛЕЧЕНО:** WIP commits and pushes to this one branch were authorized.
  No merge, deploy, PR, or production action occurred in this continuation.
- **ТРЕБУЕТСЯ:** keep the distinction between disposable/local evidence and
  hosted or production evidence in all reports.

## Work saved in this continuation

- **ИЗВЛЕЧЕНО:** the branch contains additive Aldo stage and exact
  M2-client-review work, supporting migrations, command/UI paths, tests, and
  `docs/audits/ALDO_WORKFLOW_DELIVERY_EVIDENCE.md`. The current Aldo evidence
  is an ALDO-0/reuse matrix plus partial ALDO-1 foundation, not AW-01–AW-08
  completion.
- **ИЗВЛЕЧЕНО:** WP-32 disposable utility additions were committed:
  - `1c8b023` — five-session runner;
  - `5d38253` — removes an untracked temporary finalizer dependency;
  - `5b8c644` — isolated finalizer wrapper;
  - `7f6e9a8`, `10bc7c3`, `0fa6da4` — scanner bundle restoration and
    owned-bootstrap cleanup fixes.
- **ИЗВЛЕЧЕНО:** focused finalizer unit tests passed (8/8) and
  `npm run typecheck` passed after `5d38253`. Earlier bootstrap/environment
  focused suite passed 53 tests. Treat these as local checks, not completion.
- **ИЗВЛЕЧЕНО:** the DB regression runner
  `tests/ap1/environment/run-wp32-db-regression.zsh` previously completed
  DB4 and DB5 on PostgreSQL 16 and 17:
  `WP32_DB_ALL_PASS`.
- **ИЗВЛЕЧЕНО:** the five-session runner
  `tests/ap1/environment/run-wp32-five-sessions.zsh` previously emitted:
  `AP1_SUPPORTED_SLICE_E2E_OK`, with separate Auth sessions, invitation
  acceptance, distribution acknowledgement, change/complete impact, photo
  review, milestone acceptance, replay, CSRF and isolation checks. It used a
  supplied construction photo as local disposable input; it does not prove a
  real commercial acceptance.

## WP-32: current blocker and exact next step

The final native external runner is:

```
tests/ap1/environment/run-wp32-external-finalizer.zsh
```

It invokes:

```
tests/pilot-evidence/finalize-wp32-external-runtime-cli.ts
tests/pilot-evidence/executors/wp32-external-runtime-runner.mjs
```

The intended chain is real local/disposable Auth sessions → bound source
intake/scan → M2 decision/review/handoff → native M3 documentation,
baseline and release → release artifacts/distribution/acknowledgement → M4
change/complete impact/photo review/milestone acceptance → sanitized receipt
and Cycle7 gate.

- **ИЗВЛЕЧЕНО:** before the latest source change, finalizer attempts failed
  before this chain completed, for distinct environmental/bootstrap reasons:
  1. three orphaned `pi-db4-*` PostgreSQL 16 disposable test containers made
     the profile non-empty; the owner inspected and explicitly authorized their
     removal;
  2. `/private/tmp/remhaos-clamav-linux17.rBDwPn` was absent after a restart;
  3. the first restoration script had a zsh cleanup bug because `status` is
     read-only;
  4. that failed cleanup left its own temporary
     `wp32-bundle-restore-*` container, which the next bootstrap rejected.
- **ИЗВЛЕЧЕНО:** HEAD `0fa6da4` corrects the last two bootstrap defects. It
  restores only the scanner's CVD files and `local-scan.sh` from the
  already-pinned local image, validates the temporary bundle path, and removes
  only an exact-image `wp32-bundle-restore-*` container after checking its
  ownership. It does not download anything or touch sources.
- **НЕ ПОДТВЕРЖДЕНО:** no finalizer run has passed on `0fa6da4`; therefore no
  `EXTERNAL_REAL_PACKAGE_PASS` receipt exists and `npm run test:cycle7`
  remains intentionally red without `ARCHIDOM_EXTERNAL_PILOT_RECEIPT`.

First, in a Terminal that can access only the allowed profile:

```zsh
cd /Users/msnigmatullaeva/Documents/designinterior2026/remhaos-architect-intake-20260923
export DOCKER_HOST=unix:///Users/msnigmatullaeva/.colima/archidom-ap1-disposable/docker.sock
docker ps -a --format 'table {{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'
zsh tests/ap1/environment/run-wp32-external-finalizer.zsh
```

- **ТРЕБУЕТСЯ:** before removing any container, inspect it and establish that it
  belongs to this disposable run. Never remove a VM, container, image, or data
  merely to free disk.
- **ТРЕБУЕТСЯ:** on failure, read the newest
  `/private/tmp/remhaos-architect-intake-*/evidence.json` and stage logs
  before retrying. Do not treat a generic
  `WP32_FINALIZER_EXECUTOR_FAILED` as a completed result.
- **ТРЕБУЕТСЯ:** if the exact scanner image is missing or CVD freshness fails,
  stop and record the precise code. A new official-signature download or image
  build is a separate local-runtime decision; do not substitute old receipts
  or deterministic mocks.
- **ТРЕБУЕТСЯ:** only after a sanitized receipt exists, run:

```zsh
ARCHIDOM_EXTERNAL_PILOT_RECEIPT=/private/tmp/<exact-receipt>.json npm run test:cycle7
```

and record the command, date, environment, SHA and result in
`docs/audits/wp/WP-32_EVIDENCE.md`. A local pass still is not hosted or
production acceptance.

## Aldo 01–07 status

- **ИЗВЛЕЧЕНО:** Aldo canonical scope is the additional specification and
  architecture document named above. It describes AW-01 through AW-08 across
  four public workspaces, not seven separate applications.
- **ИЗВЛЕЧЕНО:** reuse/gap matrix and the exact existing contracts are in
  `docs/audits/ALDO_WORKFLOW_DELIVERY_EVIDENCE.md`.
- **НЕ ПОДТВЕРЖДЕНО:** ALDO-1 through ALDO-6 are not completed. Do not claim
  AW-01–AW-08 complete from tables, routes, mock tests, or local UI alone.
- **ТРЕБУЕТСЯ:** finish WP-32's authenticated native M3/M4 receipt before
  declaring dependent release/acceptance flows runtime PASS. Independent pure
  Aldo domain/UI/test work may continue with a clearly unavailable runtime
  state.

Recommended next implementation order after the WP-32 receipt:

1. ALDO-1: complete AW-01 persisted seven-stage projection and AW-02
   exact-version client discussion/view/decision/revocation boundary;
2. ALDO-2: AW-03 versioned documentation checklist and AW-04 immutable
   released-package recipient manifest/receipt;
3. ALDO-3: AW-05 human contractor-offer comparison and selection;
4. ALDO-4: AW-06 applicable site route plus AW-07 field issue/RFI/change
   linkage;
5. ALDO-5: AW-08 final acceptance, defects, actual archive build/read/revoke;
6. ALDO-6: role-browser matrix, negatives, independent read-only review and
   honest evidence/handoff.

For every new contract, specify state machine, owner, transitions,
authorization, inputs/outputs, exact revision binding, audit, idempotency and
failure/restart behavior before persistence. Use existing revisions, approvals,
release/distribution, change/impact, milestone and handover contracts rather
than a parallel engine.

## Quality and evidence rules

- **ТРЕБУЕТСЯ:** use only commands supported by `package.json` and follow
  repository gates in order: lint, typecheck, targeted/full tests as applicable,
  frontend detection if UI changed, then build.
- **ИЗВЛЕЧЕНО:** a prior `release:check` was not green as a whole: lint had
  zero errors and 15 warnings, while broad tests included sandbox
  `spawn EPERM` limitations and stale/frozen architecture expectations.
  Do not repeat or classify that result as a current pass without rerunning on
  the exact current SHA.
- **ТРЕБУЕТСЯ:** browser proof needs distinct authenticated sessions for
  designer/owner, client, architect, contractor/builder and outsider. SQL,
  mocks, and unit tests are supporting evidence only.
- **ТРЕБУЕТСЯ:** preserve actual source files and their hashes; never invent
  CLEAN scan results, source provenance, prices, approvals, warranty values or
  completion evidence.

## Handoff acceptance condition

The next agent should leave an updated evidence document and a short final
handoff containing branch, HEAD, diff, every command actually run, result,
environment, remaining gates and one concrete next action. Do not close WP-32
or the Aldo program without the required evidence.
