import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { observeWatchdogIdentity } from "../../lib/integration-gateway/r1-sandbox/admission";
import { DockerClient, processGroup } from "../../lib/integration-gateway/r1-sandbox/docker";
import { SandboxRegistry } from "../../lib/integration-gateway/r1-sandbox/registry";

async function main() {
  const [registryPath, imageId, sourceHash, profile, endpoint, expectedDaemonId] = process.argv.slice(2);
  if (process.argv.length !== 8 || !registryPath || !imageId || !sourceHash || !profile || !endpoint || !expectedDaemonId) throw new Error("sandbox_arguments_invalid");
  const registry = new SandboxRegistry(registryPath);
  const docker = new DockerClient({ executable: "/opt/homebrew/bin/docker", endpoint });
  const host = await observeWatchdogIdentity(docker, "/opt/homebrew/bin/colima", profile);
  if (host.daemonId !== expectedDaemonId || registry.live(host.daemonId).length) throw new Error("sandbox_slot_unavailable");
  const env = { NODE_ENV: "production" as const, HOME: homedir(), PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" };
  const watchdog = spawn(process.execPath, ["--import", "tsx", resolve("scripts/r1-sandbox/watchdog.ts"), registryPath, profile, endpoint, expectedDaemonId], { detached: true, stdio: "ignore", env });
  if (!watchdog.pid) throw new Error("sandbox_watchdog_unavailable");
  const watchdogExit = new Promise(resolve => watchdog.once("exit", resolve));
  let supervisor: ReturnType<typeof spawn> | undefined;
  try {
    const group = await processGroup(); let live = false;
    for (let i = 0; i < 30; i++) {
      try { registry.assertWatchdog(host.daemonId, host.bootId, Date.now(), process.pid, group); live = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!live) throw new Error("sandbox_watchdog_unavailable");
    supervisor = spawn(process.execPath, ["--import", "tsx", resolve("scripts/r1-sandbox/run-probe.ts"), registryPath, imageId, sourceHash, "wait", profile, endpoint, expectedDaemonId], { detached: true, stdio: "ignore", env });
    if (!supervisor.pid) throw new Error("sandbox_supervisor_unavailable");
    const supervisorExit = new Promise(resolve => supervisor?.once("exit", resolve));
    if (await processGroup(supervisor.pid) === await processGroup(watchdog.pid)) throw new Error("sandbox_watchdog_not_independent");
    let operationId: string | undefined; let containerId: string | undefined; let observedNodeProcesses = 0;
    for (let i = 0; i < 80; i++) {
      const own = registry.live(host.daemonId).find(row => row.supervisorPid === supervisor?.pid);
      if (own?.containerId && own.state === "running" && (await docker.inspect(own.containerId))?.Running) {
        const top = await docker.command(["top", own.containerId, "-eo", "pid,args"], 1000);
        observedNodeProcesses = top.stdout.split("\n").filter(line => /^\d+\s+(?:\/usr\/local\/bin\/)?node(?:\s|$)/.test(line.trim())).length;
        if (top.code === 0 && observedNodeProcesses >= 2) { operationId = own.operationId; containerId = own.containerId; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!operationId || !containerId) throw new Error("sandbox_supervisor_not_started");
    const began = performance.now();
    // Both are newly created owned process groups; the watchdog has a distinct PGID.
    process.kill(-supervisor.pid, "SIGKILL"); await supervisorExit;
    let settled = false;
    for (let i = 0; i < 150; i++) {
      if (registry.read(operationId)?.state === "settled") { settled = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const elapsedMs = Math.round(performance.now() - began);
    const absent = (await docker.inspect(containerId)) === null;
    const survived = watchdog.exitCode === null && watchdog.signalCode === null;
    process.stdout.write(JSON.stringify({ level: "synthetic-watchdog-death-v1", operationId, containerId, supervisorPid: supervisor.pid,
      watchdogPid: watchdog.pid, watchdogSurvived: survived, observedNodeProcesses, elapsedMs, settled, absent, withinBound: elapsedMs <= 14_000 }) + "\n");
    if (!settled || !absent || !survived || elapsedMs > 14_000) process.exitCode = 1;
  } finally {
    if (supervisor?.pid && supervisor.exitCode === null && supervisor.signalCode === null) process.kill(-supervisor.pid, "SIGKILL");
    if (registry.live(host.daemonId).length === 0) {
      watchdog.kill("SIGTERM");
      await Promise.race([watchdogExit, new Promise(resolve => setTimeout(resolve, 3000))]);
      if (watchdog.exitCode === null && watchdog.signalCode === null) { watchdog.kill("SIGKILL"); await watchdogExit; }
    } else {
      process.stdout.write(JSON.stringify({ cleanup: "pending", retainedWatchdogPid: watchdog.pid }) + "\n");
      watchdog.unref();
    }
    registry.close();
  }
}
void main().catch(() => { process.stderr.write("sandbox_watchdog_death_verification_failed\n"); process.exitCode = 1; });
