# R1-03 local ClamAV process evidence

Context: repository_only. This increment implements the process adapter behind
PR #174; it does not complete the full INT-R1-03 or open Gate 0.

## Implemented boundary

The trusted worker supplies a borrowed read-only FileHandle for a pinned source
generation, server-observed byte length and SHA-256. Job input no longer selects
an executable, signature directory or filesystem path. The worker configuration
pins the executable hash, signature directory and scratch root.

The runner reads from offset zero in 64 KiB chunks, verifies the streamed hash,
length and file metadata, uses no shell and replaces the child's environment.
It permits only the three official CVD files, records their aggregate SHA-256,
and checks the signed daily database's header age (maximum 24 hours; 5 minutes
clock skew). ClamAV validates the official database signatures. The signature
updater is separate from the scan command. Database files must remain unchanged
during the scan.

Scanner limits: source 100,000,000 bytes, expanded scan 500,000,000 bytes, 2,000
files, recursion 2, stdout/stderr aggregate 64 KiB, job deadline at most 300 seconds.
Over-limit/encrypted inputs raise scanner alerts. Archive structural policy and
nested-archive rejection remain separate prerequisites. No raw scanner output
enters the result. A clean verdict requires a scan summary and matching pinned
bytes; exit zero alone is insufficient. Cancellation kills the subprocess group.
Cleanup errors and cancellation during final verification are sanitized failures.

## Verification on 2026-09-12

- `npm run release:check`: lint 0 errors/13 existing warnings; typecheck passed;
  210 files / 1,680 tests passed; build passed. Colima was selected explicitly for
  existing disposable-bootstrap tests.
- `npx tsx scripts/test-r1-clamav-local.ts <installed-clamscan> <official-cvd-dir>`:
  all six local scenarios passed: clean, EICAR, gzip EICAR, hash substitution,
  deadline, missing database. This invokes the real installed engine.
- Engine 1.5.4; daily database 28121; aggregate CVD SHA-256
  `b18d68b2b721954024cb66df4c4da97a7b05a15a5b83087642853082d149a52c`;
  executable SHA-256
  `799cdce15025a8b1e573006547c4bfaeabaa373b4aa11edb86112c47401f2c24`.
- Additional subprocess tests prove termination, silent exit rejection,
  environment filtering, output limit, stale database rejection, exact-byte
  binding, and sanitized cancellation/cleanup. Their fake engine fixtures are
  protocol tests, not antivirus evidence.
- Independent read-only review of an isolated source snapshot: PASS after
  fixing cancellation during final verification and cleanup error propagation.

## PR #160 review correction — 2026-09-12

Baseline: `e1c3269`. Scope: executable verification/launch binding and the
three-attempt job budget; no scanner policy, deployment or shared state changes.

The runner resolves the trusted installed executable (including package-manager
symlinks), opens the resolved regular file with `O_NOFOLLOW`, and copies through
that descriptor into an exclusively created file in its private job directory.
The actual copy must match the configured SHA-256 before execution. The writer
is closed, and both the copied executable and its separate runtime directory
are sealed to mode `0500`. The executable-copy limit is 100,000,000 bytes.
Only this snapshot is spawned; the installed package path is never executed.
Source path/inode/metadata and snapshot identity are checked before and after
the subprocess, and unexpected replacement fails closed. Cleanup unseals and
removes only the per-job directory.

This binds execution across an ordinary atomic package update as well as an
in-place source write. It assumes the worker UID/root and dynamic libraries are
trusted; mode bits are not the complete OS sandbox required by MASTER §5.3.
The borrowed input descriptor and scanner limits retain their prior contracts.
Scan attempts must now be safe integers in `1..3`, rejecting fractional and
non-finite values before generating an idempotency key.

Verification of the correction:

- Before the fix, the new tests produced eight failures: four replacement
  races returned `clean`, the private-copy assertion failed, and `NaN`, `1.5`
  and `2.5` attempts were accepted.
- After the fix, all 26 focused process/job tests passed, including atomic
  rename, in-place write, package symlink update, and replacement immediately
  inside the spawn call. Substituted scripts leave no execution marker; stable
  private snapshots execute successfully and are removed afterwards.
- Full local quality checks passed: lint 0 errors/13 existing warnings,
  typecheck, 210 files / 1,695 tests, and `npm run build -- --webpack`.
- Native macOS: the existing installed ClamAV 1.5.4 and official CVDs passed
  all six scenarios in `scripts/test-r1-clamav-local.ts` through the new copied
  executable, including clean, EICAR and gzip EICAR. This also exercised the
  installed Homebrew symlink and dynamic-library loading after relocation.
- Linux: the unchanged TypeScript source, transpiled to CommonJS, passed a
  Node-only synthetic process harness in the existing `node:24-alpine` image:
  clean, stable symlink, replacement after verification, replacement at spawn,
  invalid attempts, and three distinct replay-stable attempt keys. The
  disposable container had no network and ran nonroot with a read-only root.
  This is process-protocol evidence, not Linux antivirus or Gate 0 acceptance.
- Independent read-only review of the four source/test files and native/Linux
  logs found no actionable issue in this correction's scope.

## Remaining integration

This local process runner is not an OS sandbox. Network denial, nonroot UID,
read-only filesystem, CPU/RAM ceilings, durable queue lease/cancellation,
storage generation pinning and result publication still need integrated proof.
Only synthetic data was used. No client files, shared database, flags, deployment,
or cloud resources were changed.

See [ClamAV scanning documentation](https://docs.clamav.net/manual/Usage/Scanning.html)
for exit/skip limits and official signature loading. The real scanner acceptance
is distinct from parsing fidelity and application authorization.
