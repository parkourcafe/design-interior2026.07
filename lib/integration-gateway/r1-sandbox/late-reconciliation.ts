import { randomUUID } from "node:crypto";
import type { DockerClient } from "./docker";
import { cleanupOwned, ownerConfirmedAbsent, performOwnedCleanup } from "./lifecycle";
import type { IntentRecord, SandboxRegistry } from "./registry";

/** Separate late lane: bounded attempts may recover resources, never timely success.
 * Original deadlines/outcome are sticky; normal attempt exhaustion is irrelevant.
 */
export async function reconcileLateOwned(docker: DockerClient, registry: SandboxRegistry, operationId: string): Promise<IntentRecord> {
  let record = registry.read(operationId);
  if (!record) throw new Error("sandbox_intent_missing");
  if (record.state === "settled" || record.state === "ownership_conflict") return record;
  if (record.cleanupDeadlineMissedAt == null) {
    const originalEnd = record.cleanupDeadline ?? record.cleanupLeaseUntil;
    if (originalEnd == null || Date.now() < originalEnd) return record;
    record = await cleanupOwned(docker, registry, operationId);
    if (record.cleanupDeadlineMissedAt == null) return record;
  }
  const now = Date.now();
  if ((record.lateRetryAfter ?? 0) > now) return record;
  const liveAttempt = !!record.lateCleanupOwner && (record.lateCleanupDeadline ?? 0) > now;
  if (liveAttempt && !ownerConfirmedAbsent(record.lateCleanupOwnerPid)) return record;

  // No mutation against an unverified/replaced/unreachable daemon. Failed health
  // checks do not consume an attempt budget or permanently disable later recovery.
  try {
    const health = await docker.command(["info", "--format", "{{.ID}}"], 1000);
    if (health.code !== 0 || health.stdout.trim() !== record.daemonId) throw new Error("sandbox_late_daemon_unavailable");
  } catch {
    const latest = registry.read(operationId);
    if (!latest || latest.revision !== record.revision) return latest ?? record;
    return registry.cas(latest, { state: "cleanup_pending", lateRetryAfter: Date.now() + 1000, alert: "late_cleanup_waiting_verified_daemon" });
  }
  const latest = registry.read(operationId);
  if (!latest || latest.revision !== record.revision) return latest ?? record;
  const started = Date.now();
  const takeover = !!record.lateCleanupOwner && (record.lateCleanupDeadline ?? 0) > started;
  const killDeadline = takeover ? record.lateKillDeadline ?? started : started + 5000;
  const cleanupDeadline = takeover ? record.lateCleanupDeadline ?? started : started + 10000;
  const attempts = (record.lateAttempts ?? 0) + (takeover ? 0 : 1);
  const owner = randomUUID();
  const assertLease = () => {
    const current = registry.read(operationId);
    if (!current || current.lateCleanupOwner !== owner || (current.lateCleanupDeadline ?? 0) <= Date.now()) throw new Error("sandbox_stale_fence");
  };
  try {
    record = registry.cas(record, { state: "cleanup_pending", cleanupOutcome: "late", cancelRequested: true,
      lateCleanupOwner: owner, lateCleanupOwnerPid: process.pid, lateKillDeadline: killDeadline,
      lateCleanupDeadline: cleanupDeadline, lateAttempts: attempts, lateRetryAfter: null, alert: "late_cleanup_in_progress" });
    record = await performOwnedCleanup(docker, registry, record, { killDeadline, cleanupDeadline }, assertLease);
    assertLease();
    const completed = registry.read(operationId);
    if (!completed || completed.lateCleanupOwner !== owner) throw new Error("sandbox_stale_fence");
    return registry.cas(completed, { state: "settled", cleanupOutcome: "late", cancelRequested: true,
      lateCleanupOwner: null, lateCleanupOwnerPid: null, lateRetryAfter: null, alert: "cleanup_deadline_missed_reconciled" });
  } catch (error) {
    const current = registry.read(operationId);
    if (!current || current.lateCleanupOwner !== owner) return current ?? record;
    const conflict = error instanceof Error && error.message === "sandbox_ownership_conflict";
    return registry.cas(current, { state: conflict ? "ownership_conflict" : "cleanup_pending",
      cleanupOutcome: "late", cancelRequested: true, lateCleanupOwner: null, lateCleanupOwnerPid: null,
      lateRetryAfter: Date.now() + Math.min(30000, 1000 * 2 ** Math.min(attempts, 5)),
      conflictAt: conflict ? Date.now() : current.conflictAt,
      alert: conflict ? "ownership_conflict_unknown_resource_liability" : "late_cleanup_pending_reserved" });
  }
}
