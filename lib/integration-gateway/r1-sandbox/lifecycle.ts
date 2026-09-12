import { randomUUID } from "node:crypto";
import type { DockerClient } from "./docker";
import { assertOwnedContainer, intentProfile } from "./profile";
import type { IntentRecord, SandboxRegistry } from "./registry";

export async function resolveOwnedId(docker: DockerClient, registry: SandboxRegistry, record: IntentRecord, deadline = Date.now() + 5_000): Promise<IntentRecord> {
  const remaining = () => { const value = deadline - Date.now(); if (value <= 0) throw new Error("sandbox_cleanup_deadline"); return value; };
  if (record.containerId) {
    const found = await docker.inspect(record.containerId, remaining());
    if (found) assertOwnedContainer(record, found, record.containerId);
    return record;
  }
  const result = await docker.command(["ps", "--all", "--no-trunc", "--filter", `name=^/${record.name}$`, "--format", "{{.ID}}"], remaining());
  if (result.code) throw new Error("sandbox_reconciliation_unavailable");
  const ids = result.stdout.trim().split(/\s+/).filter(Boolean);
  if (ids.length === 0) throw new Error("sandbox_create_unsettled");
  if (ids.length !== 1 || !ids[0]) throw new Error("sandbox_ownership_conflict");
  const container = await docker.inspect(ids[0], remaining());
  if (!container) throw new Error("sandbox_create_unsettled");
  assertOwnedContainer(record, container);
  return registry.cas(record, { containerId: container.Id });
}

/** Only ESRCH proves this PID is absent. Live, EPERM, missing identity or PID reuse
 * do not authorize takeover. No host process-start identity helper is available;
 * PID reuse can therefore prevent immediate takeover, but cannot justify stealing a lease.
 */
export function ownerConfirmedAbsent(pid: number | null | undefined): boolean {
  if (!Number.isSafeInteger(pid) || !pid || pid < 1) return false;
  try { process.kill(pid, 0); return false; }
  catch (error) { return error instanceof Error && "code" in error && error.code === "ESRCH"; }
}

/** Never frees a reservation for unknown creation or a foreign-looking candidate. */
export async function cleanupOwned(docker: DockerClient, registry: SandboxRegistry, operationId: string): Promise<IntentRecord> {
  let record = registry.read(operationId);
  if (!record) throw new Error("sandbox_intent_missing");
  if (record.state === "settled" || record.state === "ownership_conflict") return record;
  // AV measurement owns the slot before any create dispatch. The CAS to
  // create_inflight is mandatory before Docker I/O; this state proves no object
  // was created, including when its supervisor died during FD measurement.
  if (record.state === "measuring") {
    intentProfile(record);
    if (record.mode !== "av" || record.containerId !== null) throw new Error("sandbox_ownership_conflict");
    return registry.cas(record, { state: "settled", cancelRequested: true, cleanupOutcome: "timely" });
  }
  if (record.cleanupDeadlineMissedAt != null) return record;
  const now = Date.now();
  // The first claim's absolute budgets survive owner death, retries and restart.
  // An older record's lease end is its original cleanup bound, never a new budget.
  const began = Math.min(now, record.deadline + 1_000);
  const cleanupDeadline = record.cleanupDeadline ?? record.cleanupLeaseUntil ?? began + 10_000;
  const killDeadline = record.cleanupKillDeadline ?? cleanupDeadline - 5_000;
  if (now >= cleanupDeadline) {
    return registry.cas(record, { state: "cleanup_pending", cleanupOwner: null, cleanupOwnerPid: null, cleanupLeaseUntil: null,
      cleanupKillDeadline: killDeadline, cleanupDeadline, cleanupDeadlineMissedAt: now, cleanupOutcome: "late", cancelRequested: true, alert: "BLOCKED_EXTERNAL_cleanup_deadline" });
  }
  if (record.state === "cleanup" && (record.cleanupLeaseUntil ?? 0) > now && !ownerConfirmedAbsent(record.cleanupOwnerPid)) return record;
  if (record.reconcileAttempts >= 3) {
    return record.alert === "BLOCKED_EXTERNAL_cleanup_pending" ? record : registry.cas(record, { alert: "BLOCKED_EXTERNAL_cleanup_pending" });
  }
  const owner = randomUUID();
  const assertLease = () => {
    const latest = registry.read(operationId);
    if (!latest || latest.cleanupOwner !== owner || (latest.cleanupLeaseUntil ?? 0) <= Date.now()) throw new Error("sandbox_stale_fence");
  };
  try {
    record = registry.cas(record, { state: "cleanup", cleanupOwner: owner, cleanupOwnerPid: process.pid, cleanupKillDeadline: killDeadline, cleanupDeadline, cleanupLeaseUntil: cleanupDeadline, reconcileAttempts: record.reconcileAttempts + 1 });
    record = await performOwnedCleanup(docker, registry, record, { killDeadline, cleanupDeadline }, assertLease);
    const latest = registry.read(operationId);
    if (!latest || latest.cleanupOwner !== owner || (latest.cleanupLeaseUntil ?? 0) <= Date.now()) throw new Error("sandbox_stale_fence");
    return registry.cas(latest, { state: "settled", cleanupOutcome: "timely", cleanupOwner: null, cleanupOwnerPid: null, cleanupLeaseUntil: null, alert: null });
  } catch (error) {
    const current = registry.read(operationId);
    if (!current) throw new Error("sandbox_stale_fence");
    if (current.cleanupOwner !== owner) return current;
    const conflict = error instanceof Error && error.message === "sandbox_ownership_conflict";
    return registry.cas(current, { cleanupOwner: null, cleanupOwnerPid: null, cleanupLeaseUntil: null, state: conflict ? "ownership_conflict" : "cleanup_pending",
      conflictAt: conflict ? Date.now() : current.conflictAt,
      alert: conflict ? "ownership_conflict_unknown_resource_liability" : "cleanup_pending_reserved" });
  }
}

/** Shared exact-owned I/O only. The caller owns fencing and timely/late outcome. */
export async function performOwnedCleanup(docker: DockerClient, registry: SandboxRegistry, input: IntentRecord,
  { killDeadline, cleanupDeadline }: { killDeadline: number; cleanupDeadline: number }, assertLease: () => void): Promise<IntentRecord> {
  let record = input;
  const remaining = (deadline: number) => {
    const value = deadline - Date.now();
    if (value <= 0) throw new Error("sandbox_cleanup_deadline");
    return value;
  };
  record = await resolveOwnedId(docker, registry, record, Date.now() < killDeadline ? killDeadline : cleanupDeadline);
  if (!record.containerId) throw new Error("sandbox_create_unsettled");
  let container = await docker.inspect(record.containerId, remaining(Date.now() < killDeadline ? killDeadline : cleanupDeadline));
  if (container) {
    assertOwnedContainer(record, container, record.containerId);
    if (container.Running) {
      assertLease();
      const killed = await docker.command(["kill", "--signal=KILL", record.containerId], remaining(killDeadline));
      if (killed.code) throw new Error("sandbox_kill_unconfirmed");
      const waited = await docker.command(["wait", record.containerId], remaining(cleanupDeadline));
      if (waited.code) throw new Error("sandbox_exit_unconfirmed");
    }
    container = await docker.inspect(record.containerId, remaining(cleanupDeadline));
    if (container) {
      assertOwnedContainer(record, container, record.containerId);
      if (container.Running) throw new Error("sandbox_exit_unconfirmed");
      assertLease();
      const removed = await docker.command(["rm", record.containerId], remaining(cleanupDeadline));
      if (removed.code) throw new Error("sandbox_cleanup_unconfirmed");
    }
  }
  if (await docker.inspect(record.containerId, remaining(cleanupDeadline))) throw new Error("sandbox_cleanup_unconfirmed");
  return record;
}
