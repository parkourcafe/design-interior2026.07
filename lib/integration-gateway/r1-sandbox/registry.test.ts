import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxRegistry } from "./registry";
import { expectedConfigDigest, type SandboxIntent } from "./profile";

const directories: string[] = []; const stores: SandboxRegistry[] = [];
afterEach(async () => { for (const s of stores.splice(0)) s.close(); await Promise.all(directories.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "r1-registry-test-")); directories.push(root);
  const path = join(root, "registry.sqlite");
  const registry = new SandboxRegistry(path); stores.push(registry);
  return { registry, path };
}
function intent(): SandboxIntent {
  const operationId = randomUUID(); const imageId = `sha256:${"a".repeat(64)}`;
  return { operationId, name: `r1-sandbox-${operationId}`, nonce: "b".repeat(32), fence: 1,
    daemonId: "synthetic-daemon", bootId: "synthetic-boot", imageId,
    configDigest: expectedConfigDigest(imageId, "observe"), mode: "observe", createdAt: Date.now(), deadline: Date.now() + 60_000 };
}
describe("durable local sandbox registry", () => {
  it("commits intent before create, persists across connections and rejects stale CAS", async () => {
    const { registry, path } = await fixture();
    const i = intent(); const first = await registry.admit(i, async () => {});
    const second = new SandboxRegistry(path); stores.push(second);
    expect(second.read(i.operationId)).toMatchObject({ state: "create_inflight", containerId: null, nonce: i.nonce });
    const claimed = registry.cas(first, { containerId: "c".repeat(64), state: "created" });
    expect(() => second.cas(first, { state: "settled" })).toThrow("sandbox_stale_fence");
    expect(second.read(i.operationId)?.revision).toBe(claimed.revision);
  });
  it("keeps a single slot through cleanup_pending and ownership_conflict", async () => {
    const { registry } = await fixture(); const first = await registry.admit(intent(), async () => {});
    const pending = registry.cas(first, { state: "cleanup_pending" });
    await expect(registry.admit(intent(), async () => {})).rejects.toThrow("sandbox_slot_unavailable");
    registry.cas(pending, { state: "ownership_conflict", conflictAt: Date.now(), alert: "unknown_resource_liability" });
    await expect(registry.admit(intent(), async () => {})).rejects.toThrow("sandbox_slot_unavailable");
  });
  it("serializes concurrent admission connections while a fresh-capacity check holds the lock", async () => {
    const { registry, path } = await fixture();
    const other = new SandboxRegistry(path); stores.push(other);
    let release = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const first = registry.admit(intent(), async () => gate);
    await expect(other.admit(intent(), async () => {})).rejects.toThrow();
    release(); await first;
    await expect(other.admit(intent(), async () => {})).rejects.toThrow("sandbox_slot_unavailable");
    expect(registry.live("synthetic-daemon")).toHaveLength(1);
  });
  it("rolls back failed admission without leaking a reservation", async () => {
    const { registry } = await fixture(); const i = intent();
    await expect(registry.admit(i, async () => { throw new Error("capacity"); })).rejects.toThrow("capacity");
    expect(registry.live(i.daemonId)).toEqual([]);
  });
  it("does not let later CAS clear or extend original cleanup deadlines", async () => {
    const { registry } = await fixture(); const first = await registry.admit(intent(), async () => {});
    const killDeadline = Date.now() + 5000; const cleanupDeadline = killDeadline + 5000;
    const claimed = registry.cas(first, { state: "cleanup", cleanupKillDeadline: killDeadline, cleanupDeadline });
    for (const change of [{ cleanupDeadline: cleanupDeadline + 1 }, { cleanupDeadline: null }, { cleanupDeadline: undefined }, { cleanupKillDeadline: killDeadline + 1 }]) {
      expect(() => registry.cas(claimed, change)).toThrow("sandbox_cleanup_deadline_immutable");
    }
    expect(registry.read(first.operationId)).toMatchObject({ cleanupKillDeadline: killDeadline, cleanupDeadline });
  });
  it("requires fresh independent watchdog and rejects boot/identity mismatch", async () => {
    const { registry } = await fixture(); const now = Date.now();
    expect(() => registry.assertWatchdog("d", "b", now, process.pid, 500)).toThrow();
    registry.watchdogHeartbeat("d", "b", process.pid, now, 500);
    expect(() => registry.assertWatchdog("d", "b", now, process.pid, 500)).toThrow();
    registry.watchdogHeartbeat("d", "b", process.ppid, now, 500);
    expect(() => registry.assertWatchdog("d", "b", now, process.pid, 500)).toThrow();
    registry.watchdogHeartbeat("d", "b", process.ppid, now, 600);
    expect(() => registry.assertWatchdog("d", "b", now, process.pid, 500)).not.toThrow();
    expect(() => registry.assertWatchdog("d", "b", now + 2_001, process.pid, 500)).toThrow();
    expect(() => registry.assertWatchdog("d", "other-boot", now, process.pid, 500)).toThrow();
  });
});
