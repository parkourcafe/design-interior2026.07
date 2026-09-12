# Local synthetic Docker sandbox executor

13 September 2026. Working tree based on `dbd4901`; this evidence is not an integrated release SHA.

Real-Docker observations below are historical probe evidence; the later cleanup-owner and late-reconciliation changes were checked with real subprocess/SQLite and controlled Docker transport only. No fresh real-Docker or Gate 0 proof is claimed for those patches.

This slice executes fixed synthetic Linux probes with a real Docker create → inspect → start → inspect/wait/kill → exact-ID removal lifecycle. It is not the ClamAV adapter, a byte-validation receipt, an application worker lease, or Gate 0 acceptance.

## Implemented boundary

- `profile.ts`: fixed `synthetic-small-v1` constraints (1 CPU, 256 MiB RAM, no additional swap, 64 MiB scratch, 8 MiB shm, 32 PIDs, 60-second deadline); strict actual-container state/security inspection. Known Docker null arrays differ from missing fields. A separately labelled readonly negative control is unavailable through normal `ProbeMode`.
- `docker.ts`: bounded shell-free CLI calls, explicit local Unix endpoint or explicit context, filtered Docker inspection and one-shot memory sampling over the local Unix socket. The selected Colima guest's own Docker ID must match the endpoint's daemon ID.
- `admission.ts`: fresh guest MemAvailable/boot identity, service limits/current usage, safety headroom and future growth accounting. Unknown/stale service limits deny admission. Tmpfs memory is not counted twice.
- `registry.ts`: local SQLite WAL/FULL-synchronous durable creation intents, opaque nonce/config binding, single-daemon slot, revision CAS, independent watchdog PID/PGID heartbeat and cleanup ownership lease with owner PID and immutable original kill/cleanup deadlines. This is a local trusted-infrastructure store, not a new public RPC or application database.
- `lifecycle.ts`: intent recovery after lost create reply; full ID/nonce/image/config correlation; exact-target cleanup with shared absolute budgets. Unknown ownership, unresolved creation and cleanup failures retain liability. Competing cleanup callers cannot issue duplicate kills under one live cleanup lease.
- `late-reconciliation.ts`: a separate bounded, health/identity-gated cleanup lane after the original deadline was missed; it never restores timely success.
- `watchdog.ts`: independently running process, heartbeat/boot/clock/pressure checks and fenced cleanup after supervisor loss/deadline/cancellation. No production service installation is included.
- `executor.ts`: actual lifecycle orchestration; complete result requires valid state, parsed bounded witness, durable cancellation checks, a live deadline and confirmed cleanup. Readonly control returns only `negative_control_observed`, never a positive OS/AV/readiness result, and rejects extra byte/input fields.

The trusted supervisor controls configuration; no browser, validation job or source bytes can select an image, host mount, executable argument list or readonly exception through these APIs. There are no source-byte inputs in this synthetic slice. The later approved readonly-image ClamAV seam and framed pinned-FD ingress are separate work; existing ClamAV/upload files were not changed.

## Local executable harness

Scripts under `scripts/r1-sandbox/` provide offline image preparation, a standalone watchdog, normal probe runner, readonly control, supervisor-death and create-interruption checks. The create-interruption transport executes real Docker create, then deliberately withholds its reply; it is only used by the fixed fault-test supervisor.

All host/profile/daemon arguments are explicit; scripts do not start or resize Colima. `verify-local.ts` accepts only normal probe modes. `verify-readonly-control.ts` is a separate fixed diagnostic entrypoint and accepts no byte payload. Harnesses retain and report the independent watchdog when cleanup remains pending rather than abandoning a live liability.

Example shape (use the infrastructure owner's verified binding):

```text
tsx scripts/r1-sandbox/verify-local.ts <registry.sqlite> <image-id> <probe-source-sha256> <colima-profile> <unix-endpoint> <daemon-id> [observe|cpu|pids|memory|wait]
tsx scripts/r1-sandbox/verify-readonly-control.ts <registry.sqlite> <image-id> <probe-source-sha256> <colima-profile> <unix-endpoint> <daemon-id>
tsx scripts/r1-sandbox/verify-watchdog-death.ts <registry.sqlite> <image-id> <probe-source-sha256> <colima-profile> <unix-endpoint> <daemon-id>
tsx scripts/r1-sandbox/verify-create-interruption.ts <registry.sqlite> <image-id> <probe-source-sha256> <colima-profile> <unix-endpoint> <daemon-id>
```

Preparation uses an already-cached immutable synthetic base and stopped create/copy/commit, without pull, package installation or workload execution. It records the resulting exact digest and removes its owned stopped preparation container. Docker commit metadata is not bit-for-bit reproducible; this is local synthetic preparation, not a claim that a production AV image's reproducible supply-chain gate is complete.

## Verified evidence so far

Root authorized a separate `remhaos-sandbox-isolated` guest, originally 1 CPU / 2 GiB, daemon `22fb2a87-7df4-43b4-8d38-03ae31936bb2`. Shared/default application services were not stopped or reconfigured. Before that binding, the real admission path correctly denied the default daemon's nine unbounded service envelopes and allocated no slot/container. A separate watchdog process and different PGID were observed live.

| Check | Observed outcome |
|---|---|
| Positive readonly check | UID/GID 65532, exact EROFS on an image file whose DAC mode permits writes; zero effective capabilities, NoNewPrivs 1, seccomp mode 2, exact cgroup limits; intent `cf34b6cd-d5ba-4080-b6f2-450646a74eb6`, settled/absent |
| Readonly negative control | Same UID successfully wrote the DAC-writable image file with RO deliberately disabled in the separate diagnostic path; `negative_control_observed`, intent `01944771-e08c-4d64-a809-b73fcc05f4f4`, settled/absent |
| Memory ceiling | Expected probe failure: exit 137 and Docker OOMKilled=true under 256 MiB; intent `5f10ace2-6439-40f9-a351-c1d7ea23cc04`, settled/absent. This is OOM-enforcement evidence, not a successful processing result |
| PID ceiling | EAGAIN plus `pids.events` max increment 1 after 20 child processes; intent `6aedef8f-b8ee-4345-8da2-7f9fa67b2bea`, settled/absent |
| Supervisor death without restart | Independent watchdog survived and removed exact container `8695cacedb27e0166a0879e717f4b2e2ca028cd73f5622028e80862ef41944a3` in 2,439 ms; intent `2a246f32-5c6d-4225-8c71-59d832f8fe6c`, settled/absent |
| Death after create, before ID delivery/persistence | Independent watchdog correlated and recovered exact container `40d3512000f603f9c889973cc3afc62def6d6a5e4a9a9708deaef4fb8e2d04a1` from durable intent; 2,144 ms; `recoveredExactId=true`; intent `18706d3b-b0a6-49d9-b4fd-905f9adea7e2`, settled/absent |
| CPU throttling on one-core guest | INCONCLUSIVE/failed probe assertion: 1-CPU quota matched physical capacity. No lower quota or silent profile change; the separate final-host result below closes this limitation without rewriting the historical result |

Readonly pair used image `sha256:0b0fb33b87ce2bef840abe250e25876a01a74e5737def5a636140e3faad20f06`, source SHA `2f40267f31f5e5f9f6bc3c1996d03860aa4a1b4f6522d422c4c86848602989d0`. Later memory/PID/death/create-interruption cases used image `sha256:5867a6cc34cab5d245845103e80ee59ecf14b6d5ae911f47c70c53208ca87d53`, source SHA `8c8d1c49c025d45bc01b85a702daf64fa5989458a6f2ab0a9b3e52a089bb0542`, adding exact PID-denial cause/event evidence. These are separate exact image receipts, not one synthesized run.

A first readonly control exposed a fast-exit interactive-attach/competing-cleanup race. It was not counted as passing; intent `b659ca7f-1045-4789-8328-3c46e08a6bd4` was retained until exact cleanup confirmed absence. Synthetic probes now avoid unused stdin attachment, cleanup uses a durable single owner, and regressions cover concurrent cleanup and cancellation/abort during completion. No active reservation from that failed attempt was silently released.

## Final consistent host/image rerun

Root separately approved `remhaos-sandbox-cpu2`, 2 vCPUs / 2 GiB, daemon `4789ea4a-c81a-4650-9d99-2fe713162903`. The **container quota remained 1 CPU / 256 MiB**. Every row below used the same final image `sha256:5867a6cc34cab5d245845103e80ee59ecf14b6d5ae911f47c70c53208ca87d53` and source SHA `8c8d1c49c025d45bc01b85a702daf64fa5989458a6f2ab0a9b3e52a089bb0542`.

| Case | Exact intent / result |
|---|---|
| CPU contention | `f3a6beaf-0c13-44e7-8c1e-d2b0d2fbc3f1`: 21 throttled periods, completed/settled |
| Readonly / capabilities / seccomp / cgroup / network / scratch checks | `7a84fb12-4110-4f08-a2f8-eb399953a58e`: completed/settled; exact EROFS, UID/GID 65532, CapEff zero, NoNewPrivs 1, seccomp 2, expected memory/swap/PID/CPU values |
| Separate readonly negative control | `6c6f0b1c-a414-4ab0-b767-e712d3918198`: negative_control_observed/settled, same UID wrote the fixture |
| PID enforcement | `a8f9af33-d1ff-4f73-935f-1a0917bb5ff7`: completed/settled, 20 children followed by EAGAIN and one cgroup max event |
| Expected memory failure | `f6bb5d64-4ce7-48c6-a8aa-dda45f0d0fe5`: failed/settled, exit 137 and OOMKilled=true |
| Supervisor death with child present | `d4266342-9d08-49cc-ab11-1fd1b9f1b621`: two Node processes observed before killing only the owned supervisor group; watchdog survived; settled/absent after 2,959 ms |
| Interrupted create reply | `08092933-0725-452e-96a4-9fb73681837d`: independently recovered exact ID from durable intent, settled/absent after 2,645 ms |
| Actual wall deadline | `d6231397-47e0-462a-b01e-da5f2ae80666`: ran to the 60-second deadline and correctly returned failed/settled; durable settlement/absence confirmed 125 ms after the recorded deadline, not a successful processing result |

After the last case, both owned daemon registries had zero live reservations; final-host `docker ps -a` was empty; latest watchdog PID 90206 was confirmed gone. Root subsequently removed both owned VM profiles, their disks and the transfer archive, and verified their absence. Existing default and remhaos-validation profiles were preserved. No runtime process remains from these test runs.

A strengthened process-count harness initially used a Docker top format without PID, which Docker rejected. Those runs were not counted; the retained watchdog completed cleanup and was then stopped. The final harness uses `pid,args`, verifies two Node argv rows and records that count. A separate bounded diagnostic run was cancelled and settled; it is not substituted for the successful death test above.

## Cleanup-owner cut-point correction

A later independent review found a separate P2: an owner could die just after committing a cleanup claim but before Docker I/O. The old UUID-only lease delayed recovery for 10 seconds, then granted fresh budgets. Earlier running-state supervisor-death probes did **not** exercise that cut point and do not close this finding.

The first cleanup claim now persists its owner PID and absolute kill/cleanup deadlines. First-claim timing is capped against the job deadline (+6 seconds for kill / +11 seconds for cleanup); takeover and retries reuse those same timestamps, and CAS rejects clearing or extending them (including an explicit undefined field). The watchdog examines cleanup-state ownership on each pass. Kernel `ESRCH` permits a new CAS-fenced owner immediately; live PID, `EPERM`, absent identity or another unknown result does not prove death. Expired original budgets become failed/late cleanup liability without renewing the original timers or releasing the reservation; the separately named late lane below can reconcile resources when the daemon is verified healthy. Absence verification remains mandatory before settlement.

There is no existing host process-start identity helper in this code. PID reuse can therefore hide the original owner's death: a newly live process at that PID causes conservative refusal of immediate takeover, not a claim that the old owner is dead. The code does not claim every owner failure is detected. Older PID-less claims retain their saved lease deadline and cannot obtain a fresh budget by retrying. A missed deadline retains liability until bounded late reconciliation confirms absence; true resource-ownership ambiguity still requires infrastructure evidence and is never bypassed by that lane.

A new real-child-process/shared-SQLite regression commits the cleanup claim, stops at the controlled transport boundary before any Docker I/O, kills and reaps the child, and invokes recovery with a responsive controlled transport. Before the fix, recovery either yielded to the dead owner's live lease or attempted a fresh 5-second kill budget after the original deadline. Both cases failed. After the fix, confirmed-death recovery settles promptly inside the original timestamps; the expired-budget case performs no destructive I/O and holds its reservation. Additional tests cover live/EPERM/unknown owners and immutable deadlines across CAS. The fixture initially let Node exit naturally while awaiting an unreferenced Promise; that run is not counted as forced termination. The final fixture has a bounded keepalive and asserts a live child followed by SIGKILL exit. Re-enabling the old lease-refusal guard under that forced-kill fixture failed as expected; restoring the fix passed. These are real process/SQLite plus controlled-transport proofs, not a new live-Docker claim; both disposable VMs had already been removed by root.

## Late reconciliation after a missed deadline

The normal cleanup deadline remains immutable. Missing it sets a sticky missed-deadline timestamp, `cleanupOutcome=late` and failed/cancelled execution eligibility. The watchdog then uses a distinct late-reconciliation path: verify the current daemon ID and health, claim a separately labelled bounded late attempt, and reuse the same exact-ID/nonce/image/config cleanup operations. Each late attempt has its own 5-second kill / 10-second total bound; takeover preserves that attempt's deadlines. These are reconciliation budgets, not an extension or replacement of the original successful-execution window.

Normal retry exhaustion does not permanently disable late recovery. Unavailable/wrong-daemon health checks perform no destructive work and consume no late-attempt budget; operation failures use bounded backoff (up to 30 seconds) and retain liability. A recovered daemon can therefore stop/remove an exact-owned resource later, even when normal retries were exhausted during the outage. Only verified absence releases capacity. Resource settlement remains explicitly **late/failed**, never a timely processing result, and sticky markers cannot be cleared by CAS. Foreign-looking ownership remains blocked.

The controlled regression first reproduced the defect (deadline missed, daemon recovered, container still retained forever), then verified late kill/removal/absence with the original deadlines unchanged and `cleanupOutcome=late`. Additional cases cover health/backoff, wrong daemon, sticky markers, rejection of a fresh timely path, failed removal followed by recovery, foreign candidates and a consumer that cannot upgrade a late result to success. No VM was recreated. The earlier real-Docker supervisor-death probe is not used as proof of this new path.

Independent Codex late-recovery closure was received for the reviewed snapshot; final hashes are provided to root for hash-bound integration. Claude code review is blocked by the provider limit, not recorded as PASS.

## Code checks

Final late-reconciliation source: focused 5 files / 42 tests passed; full lint passed (0 errors / 13 existing warnings), typecheck passed, full suite 225 files / 1,915 tests passed, and `npm run build -- --webpack` passed (46 static pages). This is code/controlled-transport evidence, not fresh real-Docker or Gate 0 acceptance.

Cleanup-owner correction before the late lane: focused 4 files / 35 tests passed; full lint passed (0 errors / 13 existing warnings), typecheck passed, full suite 224 files / 1,908 tests passed, and `npm run build -- --webpack` passed (46 static pages). No live Docker/VM proof was rerun for this correction.

- Focused suite before this correction: 4 files / 29 tests passed, including red→green reproductions of the independent state-field, missing-null-array, guest/daemon binding and absolute cleanup-budget findings.
- Full `npm run lint`: 0 errors, 13 existing warnings outside this directory.
- Full `npm run typecheck`: passed.
- Full `npm run test` before this correction: 224 files / 1,902 tests passed. Separately configured cycle7/DB suites are not included in that number.
- `npm run build -- --webpack`: passed; 46 static pages. Existing unset public support/legal display values used their repository placeholders.
- Node built-in SQLite currently emits its experimental-feature warning; no dependency was added.

Independent final source closure PASS: the reviewer verified all 25 files and their hashes, sizes and modes at aggregate 727d85b9514758503a87b42da2e11b4d83cbe8993a256031e4ddf30b77120e7c before this documentation-only status update. Code is unchanged. These proofs establish only the described local synthetic envelope. Real Linux ClamAV/CVD freshness, the readonly-image runner seam, source-byte ingress, application DB leases/lineage, RU hosted approval, real corpus and Gate 0 remain separate and unclaimed.
