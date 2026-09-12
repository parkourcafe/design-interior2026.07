import { assertHostAdmission, observeLocalHost, observeWatchdogIdentity } from "./admission";
import { processGroup, type DockerClient } from "./docker";
import { reconcileLateOwned } from "./late-reconciliation";
import { cleanupOwned } from "./lifecycle";
import type { SandboxRegistry } from "./registry";

export async function watchdogTick(input: { docker: DockerClient; registry: SandboxRegistry; colimaExecutable: string; profile: string; expectedDaemonId: string }, clockHealthy = true): Promise<void> {
  const host = await observeWatchdogIdentity(input.docker, input.colimaExecutable, input.profile);
  if (host.daemonId !== input.expectedDaemonId) throw new Error("sandbox_host_identity_changed");
  const now = Date.now();
  if (clockHealthy) input.registry.watchdogHeartbeat(host.daemonId, host.bootId, process.pid, now, await processGroup());
  for (const record of input.registry.live(host.daemonId)) {
    if (!clockHealthy) {
      await cancelAndCleanup(input, record.operationId);
      continue;
    }
    if (record.state === "ownership_conflict") {
      if (record.conflictAt !== null && now - record.conflictAt >= 30_000 && record.alert !== "BLOCKED_EXTERNAL_ownership_conflict") {
        input.registry.cas(record, { alert: "BLOCKED_EXTERNAL_ownership_conflict" });
      }
      continue;
    }
    if (record.cleanupDeadlineMissedAt != null || (record.cleanupDeadline != null && now >= record.cleanupDeadline)) {
      await reconcileLateOwned(input.docker, input.registry, record.operationId);
      continue;
    }
    if (record.bootId !== host.bootId || now < record.createdAt) {
      input.registry.cas(record, { state: "ownership_conflict", conflictAt: now, alert: "clock_or_boot_discontinuity" });
      continue;
    }
    if (record.deadline <= now || record.cancelRequested || now - record.supervisorHeartbeat > 2_000
      || record.state === "cleanup_pending") {
      await cancelAndCleanup(input, record.operationId);
      continue;
    }
    if (record.state === "cleanup") {
      // A fresh lease is not liveness proof. cleanupOwned checks confirmed PID
      // absence and can take over immediately without resetting either deadline.
      await cleanupOwned(input.docker, input.registry, record.operationId);
      continue;
    }
    if (record.state === "running") {
      try {
        const pressure = await observeLocalHost(input.docker, input.colimaExecutable, input.profile);
        if (pressure.daemonId !== record.daemonId || pressure.bootId !== record.bootId) throw new Error("sandbox_host_changed");
        assertHostAdmission(pressure, Date.now(), record.containerId ?? undefined);
      } catch {
        await cancelAndCleanup(input, record.operationId);
        continue;
      }
    }

  }
}

/** Must be launched as an independent local process, not in the supervisor's group. */
export async function runWatchdog(input: Parameters<typeof watchdogTick>[0], signal: AbortSignal): Promise<void> {
  let wall = Date.now(); let monotonic = performance.now();
  while (!signal.aborted) {
    const started = Date.now(); const currentMonotonic = performance.now();
    const clockHealthy = Math.abs(started - wall - (currentMonotonic - monotonic)) <= 2_000;
    wall = started; monotonic = currentMonotonic;
    try { await watchdogTick(input, clockHealthy); } catch { /* No heartbeat on failure: admission expires closed. */ }
    const remaining = Math.max(0, 1_000 - (Date.now() - started));
    await new Promise(resolve => setTimeout(resolve, remaining));
  }
}

async function cancelAndCleanup(input: Parameters<typeof watchdogTick>[0], operationId: string) {
  const latest = input.registry.read(operationId);
  if (latest && !latest.cancelRequested) input.registry.cas(latest, { cancelRequested: true });
  const result = await cleanupOwned(input.docker, input.registry, operationId);
  return result.cleanupDeadlineMissedAt != null ? reconcileLateOwned(input.docker, input.registry, operationId) : result;
}
