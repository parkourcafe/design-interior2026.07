import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as admission from "./admission";
import { DockerClient } from "./docker";
import { expectedConfigDigest, labels, SYNTHETIC_SMALL, type ContainerObservation, type SandboxIntent } from "./profile";
import { cleanupOwned } from "./lifecycle";
import { reconcileLateOwned } from "./late-reconciliation";
import { SandboxRegistry } from "./registry";
import { watchdogTick } from "./watchdog";

const roots: string[] = []; const stores: SandboxRegistry[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const r of stores.splice(0)) r.close(); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture(expired = true) {
  const root = await mkdtemp(join(tmpdir(), "r1-late-reconciliation-")); roots.push(root);
  const registry = new SandboxRegistry(join(root, "registry.sqlite")); stores.push(registry);
  const operationId = randomUUID(); const imageId = `sha256:${"a".repeat(64)}`;
  const intent: SandboxIntent = { operationId, imageId, nonce: "b".repeat(32), fence: 1, name: `r1-sandbox-${operationId}`,
    daemonId: "fixture", bootId: "fixture-boot", mode: "observe", configDigest: expectedConfigDigest(imageId, "observe"), createdAt: Date.now(), deadline: Date.now() + 60_000 };
  const first = await registry.admit(intent, async () => {});
  const originalKill = Date.now() + (expired ? -6000 : 5000); const originalCleanup = originalKill + 5000;
  const record = registry.cas(first, { state: "cleanup_pending", containerId: "c".repeat(64), cancelRequested: true,
    cleanupKillDeadline: originalKill, cleanupDeadline: originalCleanup, reconcileAttempts: 3, alert: "BLOCKED_EXTERNAL_cleanup_deadline" });
  const docker = new DockerClient({ executable: "/controlled/docker", context: "fixture" });
  const observed: ContainerObservation = { Id: "c".repeat(64), Image: imageId, Name: `/${intent.name}`, Labels: labels(intent), User: "65532:65532",
    Entrypoint: ["/usr/local/bin/node"], Cmd: ["/opt/r1/probe.mjs", "observe"], Running: true, OOMKilled: false, ExitCode: 0, Mounts: [],
    HostConfig: { ReadonlyRootfs: true, NetworkMode: "none", Privileged: false, CapDrop: ["ALL"], CapAdd: null, SecurityOpt: ["no-new-privileges"],
      Memory: SYNTHETIC_SMALL.memoryBytes, MemorySwap: SYNTHETIC_SMALL.memoryBytes, NanoCpus: 1_000_000_000, PidsLimit: 32, ShmSize: SYNTHETIC_SMALL.shmBytes,
      Tmpfs: { "/scratch": `rw,nosuid,nodev,noexec,size=${SYNTHETIC_SMALL.scratchBytes},mode=0700,uid=65532,gid=65532` }, Binds: null, Devices: [], PidMode: "", IpcMode: "private", CgroupnsMode: "private", Init: true,
      LogConfig: { Type: "none" }, RestartPolicy: { Name: "no" }, PortBindings: {}, Ulimits: [{ Name: "nofile", Soft: 256, Hard: 256 }, { Name: "core", Soft: 0, Hard: 0 }] } };
  return { registry, record, docker, observed, originalKill, originalCleanup,
    input: { registry, docker, colimaExecutable: "/controlled/colima", profile: "fixture", expectedDaemonId: "fixture" } };
}

describe("bounded late cleanup after an unavailable daemon", () => {
  it("does not spend a permanent attempt budget while health is unavailable or identity is wrong", async () => {
    const f = await fixture();
    const marked = await cleanupOwned(f.docker, f.registry, f.record.operationId);
    const originalDeadline = marked.cleanupDeadline;
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    const command = vi.spyOn(f.docker, "command").mockResolvedValue({ code: 1, stdout: "", stderr: "unavailable" });
    const inspect = vi.spyOn(f.docker, "inspect");
    const failed = await reconcileLateOwned(f.docker, f.registry, f.record.operationId);
    expect(failed).toMatchObject({ state: "cleanup_pending", lateAttempts: 0, reconcileAttempts: 3, cleanupOutcome: "late" });
    await reconcileLateOwned(f.docker, f.registry, f.record.operationId);
    expect(command).toHaveBeenCalledTimes(1);
    now += 1001;
    command.mockResolvedValue({ code: 0, stdout: "foreign-daemon", stderr: "" });
    const foreign = await reconcileLateOwned(f.docker, f.registry, f.record.operationId);
    expect(foreign.cleanupDeadline).toBe(originalDeadline);
    expect(foreign.lateAttempts).toBe(0);
    expect(inspect).not.toHaveBeenCalled();
    expect(f.registry.live("fixture")).toHaveLength(1);
  });
  it("keeps missed-deadline and late outcome sticky across CAS", async () => {
    const f = await fixture(); const marked = await cleanupOwned(f.docker, f.registry, f.record.operationId);
    expect(() => f.registry.cas(marked, { cleanupOutcome: "timely" })).toThrow("sandbox_cleanup_outcome_sticky");
    expect(() => f.registry.cas(marked, { cleanupDeadlineMissedAt: null })).toThrow("sandbox_cleanup_deadline_immutable");
    expect(() => f.registry.cas(marked, { cleanupDeadline: Date.now() + 10000 })).toThrow("sandbox_cleanup_deadline_immutable");
  });
  it("is unavailable as a fresh timely-cleanup path", async () => {
    const f = await fixture(false); const command = vi.spyOn(f.docker, "command");
    expect(await reconcileLateOwned(f.docker, f.registry, f.record.operationId)).toEqual(f.record);
    expect(command).not.toHaveBeenCalled();
  });
  it("retains capacity after a failed remove and releases only after later verified absence", async () => {
    const f = await fixture(); let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    let running = true; let removed = false; let allowRemove = false;
    const command = vi.spyOn(f.docker, "command").mockImplementation(async args => {
      if (args[0] === "info") return { code: 0, stdout: "fixture", stderr: "" };
      if (args[0] === "kill") running = false;
      if (args[0] === "rm") { if (!allowRemove) return { code: 1, stdout: "", stderr: "temporary_failure" }; removed = true; }
      return { code: 0, stdout: "0", stderr: "" };
    });
    vi.spyOn(f.docker, "inspect").mockImplementation(async () => removed ? null : { ...f.observed, Running: running });
    const first = await reconcileLateOwned(f.docker, f.registry, f.record.operationId);
    expect(first).toMatchObject({ state: "cleanup_pending", cleanupOutcome: "late", lateAttempts: 1 });
    expect(f.registry.live("fixture")).toHaveLength(1);
    now += 2001; allowRemove = true;
    const second = await reconcileLateOwned(f.docker, f.registry, f.record.operationId);
    expect(second).toMatchObject({ state: "settled", cleanupOutcome: "late", lateAttempts: 2, cleanupDeadline: f.originalCleanup });
    expect(command.mock.calls.filter(([args]) => args[0] === "kill")).toHaveLength(1);
    expect(f.registry.live("fixture")).toHaveLength(0);
  });
  it("does not remove a foreign-looking candidate even after deadline and health recovery", async () => {
    const f = await fixture();
    const command = vi.spyOn(f.docker, "command").mockResolvedValue({ code: 0, stdout: "fixture", stderr: "" });
    vi.spyOn(f.docker, "inspect").mockResolvedValue({ ...f.observed, Labels: { ...f.observed.Labels, "r1.sandbox.nonce": "foreign" } });
    expect((await reconcileLateOwned(f.docker, f.registry, f.record.operationId)).state).toBe("ownership_conflict");
    expect(command.mock.calls.map(([args]) => args[0])).toEqual(["info"]);
    expect(f.registry.live("fixture")).toHaveLength(1);
  });
  it("recovers after the original deadline without turning the failed execution into timely success", async () => {
    const f = await fixture(); let healthy = false; let running = true; let removed = false;
    vi.spyOn(admission, "observeWatchdogIdentity").mockImplementation(async () => {
      if (!healthy) throw new Error("sandbox_watchdog_health_unavailable");
      return { daemonId: "fixture", bootId: "fixture-boot" };
    });
    const command = vi.spyOn(f.docker, "command").mockImplementation(async (args, budget) => {
      if (args[0] === "info") return { code: 0, stdout: "fixture", stderr: "" };
      expect(budget).toBeGreaterThan(0); expect(budget).toBeLessThanOrEqual(10000);
      if (args[0] === "kill") running = false;
      if (args[0] === "rm") removed = true;
      return { code: 0, stdout: "0", stderr: "" };
    });
    vi.spyOn(f.docker, "inspect").mockImplementation(async () => removed ? null : { ...f.observed, Running: running });
    await expect(watchdogTick(f.input)).rejects.toThrow("sandbox_watchdog_health_unavailable");
    expect(f.registry.live("fixture")).toHaveLength(1);
    expect(command).not.toHaveBeenCalled();
    healthy = true;
    await watchdogTick(f.input);
    const result = f.registry.read(f.record.operationId);
    expect(result?.state).toBe("settled");
    expect(result).toMatchObject({ cleanupKillDeadline: f.originalKill, cleanupDeadline: f.originalCleanup, cancelRequested: true, cleanupOutcome: "late", reconcileAttempts: 3 });
    expect(result?.cleanupDeadlineMissedAt).toBeGreaterThan(f.originalCleanup);
    expect(command.mock.calls.map(([args]) => args[0])).toEqual(["info", "kill", "wait", "rm"]);
    expect(f.registry.live("fixture")).toHaveLength(0);
  });
});
