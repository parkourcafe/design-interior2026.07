import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerClient } from "./docker";
import { cleanupOwned } from "./lifecycle";
import { assertOwnedContainer, createArguments, expectedConfigDigest, labels, SYNTHETIC_SMALL, type ContainerObservation, type SandboxIntent } from "./profile";
import { SandboxRegistry } from "./registry";
const paths: string[] = []; const registries: SandboxRegistry[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const r of registries.splice(0)) r.close(); await Promise.all(paths.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "r1-lifecycle-test-")); paths.push(path);
  const registry = new SandboxRegistry(join(path, "registry.sqlite")); registries.push(registry);
  const operationId = randomUUID(); const imageId = `sha256:${"a".repeat(64)}`;
  const intent: SandboxIntent = { operationId, imageId, nonce: "b".repeat(32), fence: 1, name: `r1-sandbox-${operationId}`,
    daemonId: "fixture", bootId: "fixture", mode: "observe", configDigest: expectedConfigDigest(imageId, "observe"), createdAt: Date.now(), deadline: Date.now() + 60_000 };
  const record = await registry.admit(intent, async () => {});
  const docker = new DockerClient({ executable: "/synthetic/docker", context: "fixture" });
  return { registry, record, docker, registryPath: join(path, "registry.sqlite") };
}
function observed(intent: SandboxIntent): ContainerObservation {
  return { Id: "c".repeat(64), Image: intent.imageId, Name: `/${intent.name}`, Labels: labels(intent), User: "65532:65532",
    Entrypoint: ["/usr/local/bin/node"], Cmd: ["/opt/r1/probe.mjs", intent.mode], Running: false, OOMKilled: false, ExitCode: 0, Mounts: [],
    HostConfig: { ReadonlyRootfs: true, NetworkMode: "none", Privileged: false, CapDrop: ["ALL"], CapAdd: null,
      SecurityOpt: ["no-new-privileges"], Memory: SYNTHETIC_SMALL.memoryBytes, MemorySwap: SYNTHETIC_SMALL.memoryBytes,
      NanoCpus: 1_000_000_000, PidsLimit: 32, ShmSize: SYNTHETIC_SMALL.shmBytes,
      Tmpfs: { "/scratch": `rw,nosuid,nodev,noexec,size=${SYNTHETIC_SMALL.scratchBytes},mode=0700,uid=65532,gid=65532` },
      Binds: null, Mounts: [], Devices: [], PidMode: "", IpcMode: "private", CgroupnsMode: "private", Init: true,
      LogConfig: { Type: "none" }, RestartPolicy: { Name: "no" }, PortBindings: {},
      Ulimits: [{ Name: "nofile", Soft: 256, Hard: 256 }, { Name: "core", Soft: 0, Hard: 0 }] } };
}
describe("exact Docker ownership and cleanup", () => {
  it("generates fixed isolation arguments without mounts, pulls or shells", async () => {
    const { record } = await fixture(); const args = createArguments(record);
    for (const required of ["--pull=never", "--network=none", "--read-only", "--cap-drop=ALL", "--user=65532:65532", "--init"]) expect(args).toContain(required);
    for (const forbidden of ["--privileged", "--mount", "--volume", "--env-file", "sh", "-c"]) expect(args).not.toContain(forbidden);
    expect(() => createArguments({ ...record, imageId: "node:latest" })).toThrow();
  });
  it("checks exact configuration instead of trusting labels alone", async () => {
    const { record } = await fixture(); const c = observed(record);
    expect(() => assertOwnedContainer(record, c)).not.toThrow();
    for (const h of [{ NetworkMode: "host" }, { Memory: 0 }, { ReadonlyRootfs: false }, { SecurityOpt: ["seccomp=unconfined"] }, { Binds: ["/private:/host"] }]) {
      expect(() => assertOwnedContainer(record, { ...c, HostConfig: { ...c.HostConfig, ...h } })).toThrow("sandbox_ownership_conflict");
    }
    expect(() => assertOwnedContainer(record, { ...c, Id: "d".repeat(64) }, c.Id)).toThrow();
  });
  it.each(["Running", "OOMKilled", "ExitCode"] as const)("rejects missing or malformed %s state", async (field) => {
    const { record } = await fixture();
    for (const value of [undefined, null, "0"]) {
      const c = observed(record); Reflect.set(c, field, value);
      expect(() => assertOwnedContainer(record, c)).toThrow("sandbox_ownership_conflict");
    }
  });
  it.each(["CapAdd", "Binds", "Devices", "PortBindings"] as const)("distinguishes missing %s from Docker's known null", async (field) => {
    const { record } = await fixture(); const c = observed(record);
    Reflect.deleteProperty(c.HostConfig, field);
    expect(() => assertOwnedContainer(record, c)).toThrow("sandbox_ownership_conflict");
  });
  it("uses a single absolute cleanup budget even after slow wait and inspection", async () => {
    const { record, registry, docker } = await fixture(); const c = observed(record);
    registry.cas(record, { containerId: c.Id, state: "running" });
    let now = Date.now(); vi.spyOn(Date, "now").mockImplementation(() => now);
    let inspections = 0; let running = true; let removed = false;
    vi.spyOn(docker, "inspect").mockImplementation(async () => {
      inspections++; now += inspections === 3 ? 2000 : 1000;
      return removed ? null : { ...c, Running: running };
    });
    const command = vi.spyOn(docker, "command").mockImplementation(async (args, timeout) => {
      if (args[0] === "kill") { now += 1000; running = false; }
      if (args[0] === "wait") now += 3000;
      if (args[0] === "rm") { expect(timeout).toBe(2000); now += 500; removed = true; }
      return { code: 0, stdout: "0", stderr: "" };
    });
    expect((await cleanupOwned(docker, registry, record.operationId)).state).toBe("settled");
    expect(command.mock.calls.map(([args]) => args[0])).toEqual(["kill", "wait", "rm"]);
  });
  it("recovers a lost create response from one fully correlated candidate and removes exact ID", async () => {
    const { record, registry, docker } = await fixture(); const c = observed(record);
    let removed = false;
    const commands = vi.spyOn(docker, "command").mockImplementation(async args => {
      if (args[0] === "ps") return { code: 0, stdout: c.Id, stderr: "" };
      if (args[0] === "rm") { expect(args[1]).toBe(c.Id); removed = true; }
      return { code: 0, stdout: "", stderr: "" };
    });
    vi.spyOn(docker, "inspect").mockImplementation(async id => { expect(id).toBe(c.Id); return removed ? null : c; });
    expect((await cleanupOwned(docker, registry, record.operationId)).state).toBe("settled");
    expect(commands.mock.calls.filter(([args]) => args[0] === "rm")).toHaveLength(1);
    expect(registry.live(record.daemonId)).toHaveLength(0);
  });
  it("retains uncertainty for zero candidates and stops retrying after three attempts", async () => {
    const { record, registry, docker } = await fixture();
    const commands = vi.spyOn(docker, "command").mockResolvedValue({ code: 0, stdout: "", stderr: "" });
    for (let i = 0; i < 4; i++) await cleanupOwned(docker, registry, record.operationId);
    expect(registry.read(record.operationId)).toMatchObject({ state: "cleanup_pending", reconcileAttempts: 3, alert: "BLOCKED_EXTERNAL_cleanup_pending" });
    expect(commands).toHaveBeenCalledTimes(3);
    expect(registry.live(record.daemonId)).toHaveLength(1);
  });
  it("does not delete a foreign lookalike or release its slot", async () => {
    const { record, registry, docker } = await fixture(); const c = observed(record);
    const commands = vi.spyOn(docker, "command").mockResolvedValue({ code: 0, stdout: c.Id, stderr: "" });
    vi.spyOn(docker, "inspect").mockResolvedValue({ ...c, Labels: { ...c.Labels, "r1.sandbox.nonce": "foreign" } });
    expect((await cleanupOwned(docker, registry, record.operationId)).state).toBe("ownership_conflict");
    expect(commands.mock.calls.every(([args]) => args[0] === "ps")).toBe(true);
    expect(registry.live(record.daemonId)).toHaveLength(1);
  });
  it("allows only one active cleanup claimant while daemon work is in flight", async () => {
    const { record, registry, docker } = await fixture(); const c = observed(record);
    registry.cas(record, { containerId: c.Id, state: "running" });
    let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
    let running = true; let removed = false;
    const command = vi.spyOn(docker, "command").mockImplementation(async args => {
      if (args[0] === "kill") { await gate; running = false; }
      if (args[0] === "rm") removed = true;
      return { code: 0, stdout: "0", stderr: "" };
    });
    vi.spyOn(docker, "inspect").mockImplementation(async () => removed ? null : { ...c, Running: running });
    const first = cleanupOwned(docker, registry, record.operationId);
    while (!command.mock.calls.some(([args]) => args[0] === "kill")) await new Promise(resolve => setTimeout(resolve, 1));
    const second = cleanupOwned(docker, registry, record.operationId);
    release();
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.some(result => result.state === "settled")).toBe(true);
    expect(command.mock.calls.filter(([args]) => args[0] === "kill")).toHaveLength(1);
  });
  it.each(["live", "EPERM", "identity_unknown"] as const)("does not infer cleanup-owner death from %s", async (liveness) => {
    const { record, registry, docker } = await fixture();
    const end = Date.now() + 10000;
    const claimed = registry.cas(record, { state: "cleanup", cleanupOwner: randomUUID(), cleanupOwnerPid: liveness === "identity_unknown" ? null : process.ppid,
      cleanupLeaseUntil: end, cleanupKillDeadline: end - 5000, cleanupDeadline: end });
    const kill = vi.spyOn(process, "kill").mockImplementation(() => {
      if (liveness === "EPERM") throw Object.assign(new Error("permission_denied"), { code: "EPERM" });
      return true;
    });
    const inspect = vi.spyOn(docker, "inspect");
    expect(await cleanupOwned(docker, registry, record.operationId)).toEqual(claimed);
    expect(inspect).not.toHaveBeenCalled();
    if (liveness === "identity_unknown") expect(kill).not.toHaveBeenCalled();
  });
  it.each(["within_original_budget", "after_original_budget"] as const)("recovers owner death at the pre-I/O cut point: %s", async (timing) => {
    const { record, registry, docker, registryPath } = await fixture(); const c = observed(record);
    registry.cas(record, { containerId: c.Id, state: "running" });
    const child = spawn(process.execPath, ["--import", "tsx", resolve("lib/integration-gateway/r1-sandbox/fixtures/cleanup-owner-child.ts"), registryPath, record.operationId], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const exited = new Promise(resolve => child.once("exit", resolve));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("cleanup_cutpoint_not_reached")), 3000);
        child.once("message", message => {
          if ((message as { type?: string }).type === "claim_committed_before_docker_io") resolve();
          else reject(new Error("cleanup_cutpoint_invalid"));
        });
        child.once("exit", () => reject(new Error("cleanup_owner_exited_before_cutpoint")));
      });
      if (timeout) clearTimeout(timeout);
      const claimed = registry.read(record.operationId);
      if (!claimed?.cleanupLeaseUntil) throw new Error("cleanup_claim_missing");
      const originalCleanupDeadline = claimed.cleanupLeaseUntil;
      const originalKillDeadline = originalCleanupDeadline - 5000;
      expect(claimed.state).toBe("cleanup");
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      expect(child.kill("SIGKILL")).toBe(true); await exited;
      expect(child.signalCode).toBe("SIGKILL");
      expect(() => process.kill(child.pid ?? 0, 0)).toThrow();
      let running = true; let removed = false;
      const command = vi.spyOn(docker, "command").mockImplementation(async (args, timeoutMs) => {
        if (args[0] === "kill") {
          expect(timeoutMs).toBeLessThan(5000);
          expect(Date.now() + (timeoutMs ?? 0)).toBeLessThanOrEqual(originalKillDeadline + 5);
          running = false;
        }
        if (args[0] === "rm") {
          expect(Date.now() + (timeoutMs ?? 0)).toBeLessThanOrEqual(originalCleanupDeadline + 5);
          removed = true;
        }
        return { code: 0, stdout: "0", stderr: "" };
      });
      vi.spyOn(docker, "inspect").mockImplementation(async () => removed ? null : { ...c, Running: running });
      if (timing === "after_original_budget") vi.spyOn(Date, "now").mockReturnValue(originalCleanupDeadline + 1);
      const began = performance.now();
      const outcome = await cleanupOwned(docker, registry, record.operationId);
      if (timing === "within_original_budget") {
        expect(outcome.state).toBe("settled");
        expect(claimed.cleanupOwnerPid).toBe(child.pid);
        expect(outcome.cleanupKillDeadline).toBe(originalKillDeadline);
        expect(outcome.cleanupDeadline).toBe(originalCleanupDeadline);
        expect(performance.now() - began).toBeLessThan(1000);
        expect(command.mock.calls.map(([args]) => args[0])).toEqual(["kill", "wait", "rm"]);
      } else {
        expect(outcome.state).toBe("cleanup_pending");
        expect(outcome.cleanupDeadline).toBe(originalCleanupDeadline);
        expect(command).not.toHaveBeenCalled();
        expect(registry.live(record.daemonId)).toHaveLength(1);
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    }
  }, 5000);
  it("kills the daemon container then waits and removes it, rather than only killing the CLI", async () => {
    const { record, registry, docker } = await fixture(); const c = observed(record);
    registry.cas(record, { containerId: c.Id, state: "running" });
    let running = true; let removed = false;
    const command = vi.spyOn(docker, "command").mockImplementation(async args => {
      if (args[0] === "kill") running = false;
      if (args[0] === "rm") removed = true;
      return { code: 0, stdout: "0", stderr: "" };
    });
    vi.spyOn(docker, "inspect").mockImplementation(async () => removed ? null : { ...c, Running: running });
    expect((await cleanupOwned(docker, registry, record.operationId)).state).toBe("settled");
    expect(command.mock.calls.map(([args]) => args[0])).toEqual(["kill", "wait", "rm"]);
  });
});
