
## AV manifest and receiver components — 2026-09-13

The readonly-image scanner seam and bounded receiver are now implemented in
`r1-worker/clamav-runtime-manifest.ts`, the narrow readonly branch of
`r1-worker/clamav-process.ts`, and `r1-sandbox/av-protocol.ts`/`av-entrypoint.ts`.
They bind fixed runtime paths and measured Node/engine/entrypoint/library/CVD
bytes, retain the existing signature aggregate/freshness semantics, and use a
68-byte input header with strict bounded READY/terminal observations. The native
private-copy scanner remains available; the weak legacy outcome wrapper is not
used as this path's acceptance authority.

Independent source review and deadline-finding closure PASS. Short scanner
timeout and expired pre-scan budget now produce no_result with no terminal AV
packet; native exit2 remains scan_failed. The startup-sensitive native PID test
uses the exact reviewed9b30f9b correction with child acknowledgement and parent
fake timers; a rerun-only pass was not accepted as its fix.

Local lint/typecheck/1980 tests/Webpack build PASS (13 existing warnings). Tests
include actual fixture-file measurement and mocked engine/OS boundaries. They
do not establish a real Linux AV image, official fresh CVD provenance, kernel
isolation or real scanner acceptance.

Host streaming transport and AV-profile-aware admission/recovery (Packet C),
image preparation and actual benign/EICAR/sandbox proof (Packet D), durable DB
lease integration and RU/Gate0 remain outstanding. These components cannot turn
a parsed terminal observation into a trusted completed job on their own. No VM,
image download, provider, live configuration or production action occurred in
this increment. Independent Claude code review and final-head CI remain pending.
