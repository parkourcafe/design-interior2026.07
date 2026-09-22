import { getEventListeners } from "node:events";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as admission from "./admission";
import * as transport from "./av-transport";
import * as cleanup from "./lifecycle";
import { runSandboxedClamAv, type AvExecutorConfig } from "./av-executor";
import { DockerClient } from "./docker";
import { watchdogTick } from "./watchdog";
import { SandboxRegistry } from "./registry";
import { AV_PROFILE, expectedAvConfigDigest, labels, type ContainerObservation } from "./profile";
import { cvdBundleDigest } from "../r1-worker/clamav-runtime-manifest";
import type { ExternalValidationJobInput } from "../r1-upload/adapters";
const roots: string[] = []; const stores: SandboxRegistry[] = []; const files: Awaited<ReturnType<typeof open>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of files.splice(0)) await f.close(); for (const s of stores.splice(0)) s.close(); for (const p of roots.splice(0)) await rm(p, { recursive: true, force: true }); });
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "r1-av-executor-test-")); roots.push(root);
  const registry = new SandboxRegistry(join(root, "state.sqlite")); stores.push(registry);
  const daemon = randomUUID(), boot = randomUUID(); registry.watchdogHeartbeat(daemon, boot, process.ppid, Date.now(), 123456789);
  vi.spyOn(admission, "observeLocalHost").mockImplementation(async () => ({ daemonId: daemon, bootId: boot, at: Date.now(), totalBytes: 8 * 1024 ** 3, availableBytes: 6 * 1024 ** 3, serviceEnvelopes: [] }));
  vi.spyOn(admission, "observeWatchdogIdentity").mockImplementation(async () => ({ daemonId: daemon, bootId: boot }));
  const bytes = Buffer.from("controlled synthetic source"); const path = join(root, "source"); await writeFile(path, bytes); const file = await open(path, "r"); files.push(file);
  const descriptor = { sha256: "a".repeat(64), byteLength: 512 }; const daily = { ...descriptor, version: 1, timestampSeconds: Math.floor(Date.now() / 1000) };
  const cvds = { "main.cvd": descriptor, "daily.cvd": daily, "bytecode.cvd": descriptor };
  const manifest = { schemaVersion: "r1-av-runtime-manifest/v1", protocolVersion: "r1-av-wire/v1", scannerPolicyVersion: "r1-clamav-policy/v1", buildReference: "fixture", licenseReference: "fixture",
    nodeVersion: "22.0.0", nodeExecutable: descriptor, executable: { ...descriptor, version: "1.5.4" }, entrypoint: descriptor,
    libraries: [{ ...descriptor, path: "/usr/lib/libfixture.so" }], cvds, signatureBundleSha256: cvdBundleDigest(cvds) };
  const manifestBytes = Buffer.from(JSON.stringify(manifest)); const manifestSha256 = sha(manifestBytes); const imageId = `sha256:${"b".repeat(64)}`;
  const docker = new DockerClient({ executable: "/fixture/docker", context: "fixture" }); const id = "c".repeat(64); let removed = false; let started = false;
  const calls: string[] = []; let finalChange: Partial<ContainerObservation> = {};
  vi.spyOn(docker, "command").mockImplementation(async args => {
    calls.push(String(args[0]));
    if (args[0] === "image") return { code: 0, stderr: "", stdout: JSON.stringify({ id: imageId, os: "linux", arch: "arm64", user: "65532:65532", entrypoint: ["/opt/r1/bin/node"], volumes: null, env: [] }) };
    if (args[0] === "create") { expect(registry.live(daemon)[0]?.state).toBe("create_inflight"); return { code: 0, stderr: "", stdout: id }; }
    if (args[0] === "wait") return { code: 0, stderr: "", stdout: "0\n" };
    if (args[0] === "kill") finalChange = { ...finalChange, Running: false };
    if (args[0] === "rm") removed = true;
    return { code: 0, stderr: "", stdout: "" };
  });
  vi.spyOn(docker, "inspect").mockImplementation(async () => {
    if (removed) return null; const intent = registry.live(daemon)[0]!;
    return { Id: id, Image: imageId, Name: `/${intent.name}`, Labels: labels(intent), User: "65532:65532", Entrypoint: ["/opt/r1/bin/node"],
      Cmd: ["/opt/r1/av-entrypoint.cjs", "--manifest-sha256", manifestSha256, "--remaining-ms", String(intent.av!.receiverBudgetMs)], Running: false, OOMKilled: false, ExitCode: 0, Mounts: [],
      HostConfig: { ReadonlyRootfs: true, NetworkMode: "none", Privileged: false, CapDrop: ["ALL"], CapAdd: [], SecurityOpt: ["no-new-privileges"], Memory: AV_PROFILE.memoryBytes, MemorySwap: AV_PROFILE.memoryBytes, NanoCpus: 1_000_000_000, PidsLimit: AV_PROFILE.pids, ShmSize: AV_PROFILE.shmBytes,
        Tmpfs: { "/scratch": `rw,nosuid,nodev,noexec,size=${AV_PROFILE.scratchBytes},mode=0700,uid=65532,gid=65532` }, Binds: null, Devices: [], PidMode: "", IpcMode: "private", CgroupnsMode: "private", Init: true, LogConfig: { Type: "none" }, RestartPolicy: { Name: "no" }, PortBindings: {}, Ulimits: [{ Name: "nofile", Soft: 256, Hard: 256 }, { Name: "core", Soft: 0, Hard: 0 }] }, ...(started ? finalChange : {}) };
  });
  vi.spyOn(transport, "streamAvToContainer").mockImplementation(async (_docker, input) => {
    started = true; calls.push("attach");
    for await (const chunk of transport.streamPinnedAvInput(input)) expect(chunk.length).toBeLessThanOrEqual(65536);
    return { protocol: "r1-av-wire/v1", kind: "av_result", runtimeManifestSha256: manifestSha256, nonce: input.header.nonce, sourceSha256: input.header.sourceSha256, byteLength: input.header.byteLength,
      outcome: "clean", nativeExitCode: 0, evidence: { sourceSha256: input.header.sourceSha256, byteLength: input.header.byteLength, runtimeManifestSha256: manifestSha256,
        executableSha256: descriptor.sha256, engineVersion: "1.5.4", signatureBundleSha256: manifest.signatureBundleSha256, signatureVersion: 1, dailyTimestampSeconds: daily.timestampSeconds, scannerPolicyVersion: "r1-clamav-policy/v1" } };
  });
  const scope = { organizationId: randomUUID(), projectId: randomUUID(), packageId: randomUUID() }; const generationId = randomUUID();
  const job: ExternalValidationJobInput = { jobId: randomUUID(), scope, generationId, observedLength: bytes.length, requestedFormat: "pdf", attempt: 1, fence: 1, leaseCapability: "fixture-private-capability", leaseExpiresAtMs: Date.now() + 10000,
    pinnedObject: { kind: "provider_version", scope, generationId, observedLength: bytes.length, adapterId: "fixture", privateLocator: "fixture-private-locator", immutableVersionId: "fixture-version", providerReceiptDigest: "d".repeat(64) } };
  const authority = { assertPinned: vi.fn(async () => { expect(registry.live(daemon)[0]?.state).toBe("measuring"); }), assertCurrent: vi.fn(async () => {}) };
  const config: AvExecutorConfig = { docker, registry, authority, colimaExecutable: "/fixture/colima", profile: "fixture", expectedDaemonId: daemon,
    runtime: { imageId, architecture: "arm64", manifestBytes, manifestSha256 } };
  return { root, registry, daemon, boot, config, calls, authority, path, input: { file, job, processingDeadlineMs: Date.now() + 10000, signal: new AbortController().signal },
    resetRunningDaemon: () => { removed = false; started = true; finalChange = { Running: true }; },
    changeFinal: (change: Partial<ContainerObservation>) => { finalChange = change; } };
}
describe("AV executor controlled transport/authority fixtures; no live engine or lease proof", () => {
  it.each(["missing_pin", "non_cloneable"])("sanitizes malformed job %s and removes its abort listener before any I/O", async kind => {
    const f = await fixture();
    const malformed = kind === "missing_pin" ? { ...f.input.job, pinnedObject: undefined }
      : { ...f.input.job, unexpectedFunction: () => "private diagnostic" };
    const stat = vi.spyOn(f.input.file, "stat"); const read = vi.spyOn(f.input.file, "read");
    expect(getEventListeners(f.input.signal, "abort")).toHaveLength(0);
    await expect(runSandboxedClamAv({ ...f.input, job: malformed as unknown as ExternalValidationJobInput }, f.config))
      .resolves.toEqual({ kind: "no_result", cleanup: "not_started", reason: "sandbox_av_incomplete" });
    expect(getEventListeners(f.input.signal, "abort")).toHaveLength(0);
    expect(f.calls).toEqual([]); expect(f.authority.assertCurrent).not.toHaveBeenCalled(); expect(f.authority.assertPinned).not.toHaveBeenCalled();
    expect(stat).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled(); expect(f.registry.live(f.daemon)).toEqual([]);
  });
  it("reserves before measurement and accepts only correlated packet/daemon/lease/absence", async () => {
    const f = await fixture(); const result = await runSandboxedClamAv(f.input, f.config);
    expect(result.kind).toBe("av_result"); expect(f.calls).toEqual(["image", "create", "attach", "wait", "rm"]);
    expect(f.registry.live(f.daemon)).toEqual([]); expect(await f.input.file.stat()).toBeTruthy();
    if (result.kind === "av_result") expect(JSON.stringify(f.registry.read(result.operationId))).not.toContain("fixture-private");
  });
  it.each(["measurement", "start", "terminal", "cleanup"])("rejects current authority revocation at %s", async stage => {
    const f = await fixture(); f.authority.assertCurrent.mockImplementation(async (...args: unknown[]) => { if (args[1] === stage) throw new Error("revoked"); });
    expect((await runSandboxedClamAv(f.input, f.config)).kind).toBe("no_result");
    if (stage === "measurement" || stage === "start") expect(f.calls).not.toContain("create");
  });
  it("refuses authority revocation between create and attachment", async () => {
    const f = await fixture(); let starts = 0;
    f.authority.assertCurrent.mockImplementation(async (...args: unknown[]) => { if (args[1] === "start" && ++starts === 2) throw new Error("revoked"); });
    expect((await runSandboxedClamAv(f.input, f.config)).kind).toBe("no_result"); expect(f.calls).toContain("create"); expect(f.calls).not.toContain("attach");
  });
  it("refuses changed bytes between initial measurement and send", async () => {
    const f = await fixture();
    f.authority.assertCurrent.mockImplementation(async (...args: unknown[]) => { if (args[1] === "start") await writeFile(f.path, "changed synthetic source"); });
    expect((await runSandboxedClamAv(f.input, f.config)).kind).toBe("no_result");
  });
  it("refuses daemon replacement after a terminal packet", async () => {
    const f = await fixture(); vi.mocked(admission.observeWatchdogIdentity).mockResolvedValue({ daemonId: "replaced", bootId: "replaced" });
    expect((await runSandboxedClamAv(f.input, f.config)).kind).toBe("no_result");
  });
  it("refuses incorrect packet correlation even if a transport implementation returns it", async () => {
    const f = await fixture(); const original = vi.mocked(transport.streamAvToContainer).getMockImplementation()!;
    vi.mocked(transport.streamAvToContainer).mockImplementation(async (...args) => {
      const result = await original(...args); return result.kind === "no_result" ? result : { ...result, nonce: "0".repeat(32) };
    });
    expect((await runSandboxedClamAv(f.input, f.config)).kind).toBe("no_result");
  });
  it("does not dispatch create when pin verification fails; pre-create reservation can settle safely", async () => {
    const f = await fixture(); f.authority.assertPinned.mockRejectedValue(new Error("unproved pin"));
    expect(await runSandboxedClamAv(f.input, f.config)).toMatchObject({ kind: "no_result", cleanup: "settled" }); expect(f.calls).not.toContain("create"); expect(f.registry.live(f.daemon)).toEqual([]);
  });
  it("refuses lease expiry during measurement before start", async () => {
    const f = await fixture(); f.input.job = { ...f.input.job, leaseExpiresAtMs: Date.now() + 50 };
    f.authority.assertPinned.mockImplementation(async () => { await new Promise(resolve => setTimeout(resolve, 75)); });
    expect((await runSandboxedClamAv(f.input, f.config)).kind).toBe("no_result"); expect(f.calls).not.toContain("create");
  });
  it.each([{ OOMKilled: true }, { ExitCode: 2 }, { Running: true }])("refuses successful attachment without successful daemon state %j", async change => {
    const f = await fixture(); f.changeFinal(change); expect((await runSandboxedClamAv(f.input, f.config)).kind).toBe("no_result");
  });
  it("never rehabilitates a late settled cleanup", async () => {
    const f = await fixture(); const original = cleanup.cleanupOwned;
    vi.spyOn(cleanup, "cleanupOwned").mockImplementation(async (...args) => ({ ...await original(...args), cleanupOutcome: "late", cleanupDeadlineMissedAt: Date.now() }));
    expect((await runSandboxedClamAv(f.input, f.config)).kind).toBe("no_result");
  });
  it("recovers a killed supervisor during real pipe streaming through shared journal/watchdog", async () => {
    const f = await fixture();
    // Reuse a correctly inspected AV intent, then model a running exact-owned
    // container in the controlled daemon while a separate supervisor streams.
    const first = await runSandboxedClamAv(f.input, f.config);
    if (!first.operationId) throw new Error("fixture_operation_missing");
    const previous = f.registry.read(first.operationId)!; const operationId = randomUUID();
    const av = { ...previous.av!, receiverBudgetMs: 10000 };
    const admitted = await f.registry.admit({ ...previous, operationId, name: `r1-sandbox-${operationId}`, av,
      configDigest: expectedAvConfigDigest(previous.imageId, av), createdAt: Date.now(), deadline: Date.now() + 10000 }, async () => {});
    const dispatched = f.registry.cas(admitted, { state: "create_inflight" });
    const running = f.registry.cas(dispatched, { state: "running", containerId: "c".repeat(64) });
    const source = join(f.root, "stream-source"); await writeFile(source, Buffer.alloc(200000, 42));
    const executable = join(f.root, "stream-cli");
    await writeFile(executable, `#!${process.execPath}\nprocess.stdout.write(JSON.stringify({protocol:'r1-av-wire/v1',kind:'ready',runtimeManifestSha256:'${av.manifestSha256}'})+'\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));setTimeout(()=>process.exit(2),10000);`);
    await chmod(executable, 0o700);
    const child = spawn(process.execPath, ["--import", "tsx", resolve("lib/integration-gateway/r1-sandbox/fixtures/av-streaming-supervisor.ts"), join(f.root, "state.sqlite"), operationId, source, executable], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const exited = new Promise(resolve => child.once("exit", resolve)); let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("av_cutpoint_unreached")), 5000);
        child.once("message", message => (message as { type?: string }).type === "attached_streaming_cutpoint" ? resolve() : reject(new Error("av_cutpoint_invalid")));
        child.once("exit", () => reject(new Error("av_supervisor_early_exit")));
      });
      clearTimeout(timeout); child.kill("SIGKILL"); await exited; expect(child.signalCode).toBe("SIGKILL");
      f.registry.cas(running, { supervisorHeartbeat: Date.now() - 3000 });
      // The daemon-owned job survives its supervisor; only exact kill/wait/rm
      // and verified absence can release the reservation.
      f.resetRunningDaemon();
      await watchdogTick({ ...f.config });
      expect(f.registry.read(operationId)).toMatchObject({ state: "settled", cancelRequested: true });
      expect(f.calls.slice(-3)).toEqual(["kill", "wait", "rm"]);
    } finally { if (timeout) clearTimeout(timeout); child.kill("SIGKILL"); await exited; }
  }, 10000);
  it("charges 3GiB rather than the synthetic 256MiB profile", async () => {
    const f = await fixture(); vi.mocked(admission.observeLocalHost).mockImplementation(async () => ({ daemonId: f.daemon, bootId: "fixture", at: Date.now(), totalBytes: 2 * 1024 ** 3, availableBytes: 1.8 * 1024 ** 3, serviceEnvelopes: [] }));
    f.registry.watchdogHeartbeat(f.daemon, "fixture", process.ppid, Date.now(), 123456789);
    expect((await runSandboxedClamAv(f.input, f.config)).kind).toBe("no_result"); expect(f.calls).not.toContain("create");
  });
});
