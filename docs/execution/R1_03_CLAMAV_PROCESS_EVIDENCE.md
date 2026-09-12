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

## Remaining integration

This local process runner is not an OS sandbox. Network denial, nonroot UID,
read-only filesystem, CPU/RAM ceilings, durable queue lease/cancellation,
storage generation pinning and result publication still need integrated proof.
Only synthetic data was used. No client files, shared database, flags, deployment,
or cloud resources were changed.

See [ClamAV scanning documentation](https://docs.clamav.net/manual/Usage/Scanning.html)
for exit/skip limits and official signature loading. The real scanner acceptance
is distinct from parsing fidelity and application authorization.
