import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { observeWatchdogIdentity } from "../../lib/integration-gateway/r1-sandbox/admission";
import { boundedCommand, DockerClient, processGroup } from "../../lib/integration-gateway/r1-sandbox/docker";
import { runSyntheticProbe } from "../../lib/integration-gateway/r1-sandbox/executor";
import { PROBE_MODES, type ProbeMode } from "../../lib/integration-gateway/r1-sandbox/profile";
import { SandboxRegistry } from "../../lib/integration-gateway/r1-sandbox/registry";

async function main() {
  const [registryPath, imageId, probeSourceSha256, profile, endpoint, expectedDaemonId] = process.argv.slice(2);
  if (!registryPath || !imageId || !probeSourceSha256 || !profile || !endpoint || !expectedDaemonId) throw new Error("sandbox_arguments_invalid");
  const mode = process.argv[8] ?? "observe";
  if (!PROBE_MODES.includes(mode as ProbeMode) || process.argv.length > 9) throw new Error("sandbox_probe_mode_invalid");
  const registry = new SandboxRegistry(registryPath);
  const docker = new DockerClient({ executable: "/opt/homebrew/bin/docker", endpoint });
  const identity = await observeWatchdogIdentity(docker, "/opt/homebrew/bin/colima", profile);
  const child = spawn(process.execPath, ["--import", "tsx", resolve("scripts/r1-sandbox/watchdog.ts"), registryPath, profile, endpoint, expectedDaemonId], {
    detached: true, stdio: "ignore", env: { NODE_ENV: "production", HOME: homedir(), PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" },
  });
  if (!child.pid) throw new Error("sandbox_watchdog_start_failed");
  const exit = new Promise(resolve => child.once("exit", resolve));
  let live = false;
  const supervisorGroup = await processGroup();
  try {
    for (let attempt = 0; attempt < 30; attempt++) {
      try { registry.assertWatchdog(identity.daemonId, identity.bootId, Date.now(), process.pid, supervisorGroup); live = true; break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    if (!live) throw new Error("sandbox_watchdog_unavailable");
    const parentGroup = await boundedCommand("/bin/ps", ["-o", "pgid=", "-p", String(process.pid)], 1000);
    const childGroup = await boundedCommand("/bin/ps", ["-o", "pgid=", "-p", String(child.pid)], 1000);
    if (parentGroup.code || childGroup.code || parentGroup.stdout.trim() === childGroup.stdout.trim()) throw new Error("sandbox_watchdog_not_independent");
    const start = Date.now();
    try {
      const result = await runSyntheticProbe({ registry, docker, colimaExecutable: "/opt/homebrew/bin/colima", profile, expectedDaemonId, imageId, probeSourceSha256 }, mode as ProbeMode, new AbortController().signal);
      process.stdout.write(JSON.stringify({ watchdogIndependent: true, watchdogLive: true, elapsedMs: Date.now() - start, result }) + "\n");
    } catch (error) {
      process.stdout.write(JSON.stringify({ watchdogIndependent: true, watchdogLive: true, elapsedMs: Date.now() - start,
        outcome: "failed_closed", reason: error instanceof Error && /^sandbox_[a-z_]+$/.test(error.message) ? error.message : "sandbox_failed",
        reservations: registry.live(identity.daemonId).length }) + "\n");
    }
  } finally {
    for (let i = 0; i < 110 && registry.live(identity.daemonId).length; i++) await new Promise(resolve => setTimeout(resolve, 100));
    if (registry.live(identity.daemonId).length === 0) {
      child.kill("SIGTERM");
      await Promise.race([exit, new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exit; }
    } else {
      process.stdout.write(JSON.stringify({ cleanup: "pending", retainedWatchdogPid: child.pid }) + "\n");
      child.unref();
      process.exitCode = 1;
    }
    registry.close();
  }
}
void main().catch(() => { process.stderr.write("sandbox_local_verification_failed\n"); process.exitCode = 1; });
