import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as cleanup from "./lifecycle";
import * as admission from "./admission";
import { DockerClient } from "./docker";
import { runReadonlyNegativeControl, runSyntheticProbe } from "./executor";
import { SandboxRegistry } from "./registry";
import { labels, SYNTHETIC_SMALL, type ContainerObservation } from "./profile";
const directories: string[] = []; const registries: SandboxRegistry[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const r of registries.splice(0)) r.close(); await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "r1-executor-test-")); directories.push(root);
  const registry = new SandboxRegistry(join(root, "registry.sqlite")); registries.push(registry);
  const daemonId = randomUUID(); const bootId = randomUUID();
  registry.watchdogHeartbeat(daemonId, bootId, process.ppid, Date.now(), 123456789);
  vi.spyOn(admission, "observeLocalHost").mockImplementation(async () => ({ daemonId, bootId, at: Date.now(), totalBytes: 4 * 1024 ** 3, availableBytes: 3 * 1024 ** 3, serviceEnvelopes: [] }));
  const docker = new DockerClient({ executable: "/synthetic/docker", context: "fixture" });
  const imageId = `sha256:${"a".repeat(64)}`; const source = "b".repeat(64); const id = "c".repeat(64);
  let removed = false;
  const calls: string[] = [];
  vi.spyOn(docker, "command").mockImplementation(async args => {
    calls.push(String(args[0]));
    if (args[0] === "image") return { code: 0, stderr: "", stdout: JSON.stringify({ id: imageId, os: "linux", arch: "arm64", user: "65532:65532", entrypoint: ["/usr/local/bin/node"], volumes: null, env: [], labels: { "r1.synthetic.source": source } }) };
    if (args[0] === "create") {
      expect(registry.live(daemonId)).toHaveLength(1);
      expect(registry.live(daemonId)[0]?.state).toBe("create_inflight");
      return { code: 0, stdout: id, stderr: "" };
    }
    if (args[0] === "start") return { code: 0, stderr: "", stdout: JSON.stringify({ level: "synthetic-small-v1", mode: "observe", ok: true, evidence: { uid: 65532, gid: 65532, rootfsWriteError: "EROFS", status: { CapEff: "0000000000000000", NoNewPrivs: "1", Seccomp: "2" }, cpuMax: "100000 100000", memoryMax: "268435456", swapMax: "0", pidsMax: "32" } }) };
    if (args[0] === "rm") removed = true;
    return { code: 0, stdout: "", stderr: "" };
  });
  vi.spyOn(docker, "inspect").mockImplementation(async requested => {
    if (removed) return null;
    expect(requested).toBe(id);
    const intent = registry.live(daemonId)[0];
    if (!intent) throw new Error("missing_intent");
    const c: ContainerObservation = { Id: id, Image: imageId, Name: `/${intent.name}`, Labels: labels(intent), User: "65532:65532", Entrypoint: ["/usr/local/bin/node"], Cmd: ["/opt/r1/probe.mjs", "observe"], Running: false, OOMKilled: false, ExitCode: 0, Mounts: [],
      HostConfig: { ReadonlyRootfs: true, NetworkMode: "none", Privileged: false, CapDrop: ["ALL"], CapAdd: [], SecurityOpt: ["no-new-privileges"], Memory: SYNTHETIC_SMALL.memoryBytes, MemorySwap: SYNTHETIC_SMALL.memoryBytes, NanoCpus: 1_000_000_000, PidsLimit: 32, ShmSize: SYNTHETIC_SMALL.shmBytes, Tmpfs: { "/scratch": `rw,nosuid,nodev,noexec,size=${SYNTHETIC_SMALL.scratchBytes},mode=0700,uid=65532,gid=65532` }, Binds: null, Devices: [], PidMode: "", IpcMode: "private", CgroupnsMode: "private", Init: true, LogConfig: { Type: "none" }, RestartPolicy: { Name: "no" }, PortBindings: {}, Ulimits: [{ Name: "nofile", Soft: 256, Hard: 256 }, { Name: "core", Soft: 0, Hard: 0 }] } };
    return c;
  });
  return { registry, daemonId, docker, calls, config: { registry, docker, colimaExecutable: "/synthetic/colima", profile: "fixture", expectedDaemonId: daemonId, imageId, probeSourceSha256: source } };
}
describe("real launcher orchestration with synthetic command transport fixtures", () => {
  it("does not expose readonly control through normal mode or accept real input into control", async () => {
    const f = await fixture();
    await expect(runSyntheticProbe(f.config, "readonly-negative-control" as never, new AbortController().signal)).rejects.toThrow("sandbox_probe_mode_invalid");
    await expect(runReadonlyNegativeControl({ ...f.config, bytes: Buffer.from("forbidden") } as never, new AbortController().signal)).rejects.toThrow("sandbox_control_input_forbidden");
    expect(f.calls).toEqual([]);
  });
  it("persists intent before create, checks config before start and releases only after absence", async () => {
    const f = await fixture();
    expect(await runSyntheticProbe(f.config, "observe", new AbortController().signal)).toMatchObject({ outcome: "completed", cleanup: "settled" });
    expect(f.calls).toEqual(["image", "create", "start", "rm"]);
    expect(f.registry.live(f.daemonId)).toEqual([]);
  });
  it("does not create under unknown service envelopes", async () => {
    const f = await fixture();
    vi.mocked(admission.observeLocalHost).mockResolvedValue({ daemonId: f.daemonId, bootId: "b", at: Date.now(), totalBytes: 4 * 1024 ** 3, availableBytes: 3 * 1024 ** 3, serviceEnvelopes: [{ id: "pg", limit: 0, used: 0 }] });
    f.registry.watchdogHeartbeat(f.daemonId, "b", process.ppid, Date.now(), 123456789);
    await expect(runSyntheticProbe(f.config, "observe", new AbortController().signal)).rejects.toThrow("sandbox_service_envelope_unknown");
    expect(f.calls).toEqual(["image"]);
  });
  it("never reports a successful result after durable cancellation wins the completion race", async () => {
    const f = await fixture(); const original = vi.mocked(f.docker.command).getMockImplementation();
    vi.mocked(f.docker.command).mockImplementation(async (...args) => {
      if (!original) throw new Error("fixture_missing");
      const result = await original(...args);
      if (args[0][0] === "start") {
        const record = f.registry.live(f.daemonId)[0];
        if (!record) throw new Error("fixture_missing");
        f.registry.cas(record, { cancelRequested: true });
      }
      return result;
    });
    expect(await runSyntheticProbe(f.config, "observe", new AbortController().signal)).toMatchObject({ outcome: "failed", cleanup: "settled" });
  });
  it("does not publish success when abort arrives during final cleanup", async () => {
    const f = await fixture(); const original = vi.mocked(f.docker.command).getMockImplementation();
    const controller = new AbortController();
    vi.mocked(f.docker.command).mockImplementation(async (...args) => {
      if (!original) throw new Error("fixture_missing");
      const result = await original(...args);
      if (args[0][0] === "rm") controller.abort();
      return result;
    });
    expect(await runSyntheticProbe(f.config, "observe", controller.signal)).toMatchObject({ outcome: "failed", cleanup: "settled" });
  });
  it("never upgrades a settled late cleanup result into a successful execution", async () => {
    const f = await fixture(); const original = cleanup.cleanupOwned;
    vi.spyOn(cleanup, "cleanupOwned").mockImplementation(async (...args) => {
      const result = await original(...args);
      return { ...result, cleanupDeadlineMissedAt: Date.now(), cleanupOutcome: "late", cancelRequested: false };
    });
    expect(await runSyntheticProbe(f.config, "observe", new AbortController().signal)).toMatchObject({ outcome: "failed", cleanup: "settled" });
  });
  it("blocks startup when the watchdog dies after create", async () => {
    const f = await fixture(); let reads = 0;
    const base = vi.mocked(admission.observeLocalHost).getMockImplementation();
    vi.mocked(admission.observeLocalHost).mockImplementation(async (...args) => {
      if (!base) throw new Error("fixture_missing");
      const host = await base(...args);
      if (++reads === 3) f.registry.watchdogHeartbeat(host.daemonId, host.bootId, process.ppid, Date.now() - 3000, 123456789);
      return host;
    });
    expect(await runSyntheticProbe(f.config, "observe", new AbortController().signal)).toMatchObject({ outcome: "failed", cleanup: "settled" });
    expect(f.calls).not.toContain("start");
  });
});
