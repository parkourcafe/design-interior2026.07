import { boundedCommand, type DockerClient } from "./docker";
import { AV_PROFILE, SYNTHETIC_SMALL } from "./profile";

export interface HostObservation {
  readonly daemonId: string; readonly bootId: string; readonly at: number;
  readonly totalBytes: number; readonly availableBytes: number;
  readonly serviceEnvelopes: readonly { readonly id: string; readonly limit: number; readonly used: number }[];
}
export async function observeLocalHost(docker: DockerClient, colimaExecutable: string, profile: string): Promise<HostObservation> {
  if (!/^\/[\w/.-]+$/.test(colimaExecutable) || !/^[a-z0-9-]+$/.test(profile)) throw new Error("sandbox_metrics_config_invalid");
  const observedAt = Date.now();
  const info = await docker.command(["info", "--format", '{"id":{{json .ID}},"os":{{json .OSType}},"cgroup":{{json .CgroupVersion}},"security":{{json .SecurityOptions}}}']);
  const engine = JSON.parse(info.stdout) as { id: string; os: string; cgroup: string; security: string[] };
  if (info.code || !engine.id || engine.os !== "linux" || engine.cgroup !== "2"
    || !engine.security.some(option => option.startsWith("name=seccomp,profile=builtin"))) throw new Error("sandbox_host_unsupported");
  await assertGuestDaemon(colimaExecutable, profile, engine.id);
  const inventory = await docker.command(["ps", "--no-trunc", "--format", "{{.ID}}"]);
  if (inventory.code) throw new Error("sandbox_inventory_unavailable");
  const ids = inventory.stdout.trim().split(/\s+/).filter(Boolean);
  const serviceEnvelopes: { id: string; limit: number; used: number }[] = [];
  if (ids.some(id => !/^[a-f0-9]{64}$/.test(id))) throw new Error("sandbox_inventory_invalid");
  if (ids.length) {
    const limits = await docker.command(["inspect", "--format", "{{.Id}} {{.HostConfig.Memory}}", ...ids]);
    if (limits.code) throw new Error("sandbox_inventory_unavailable");
    for (const line of limits.stdout.trim().split("\n")) {
      const [id, rawLimit] = line.trim().split(" ");
      const limit = Number(rawLimit);
      if (!id || !Number.isSafeInteger(limit) || limit < 0) throw new Error("sandbox_inventory_invalid");
      // Unknown envelopes deny admission; do not turn absent limits into assumed headroom.
      const used = limit === 0 ? 0 : (await docker.memorySample(id)).used;
      serviceEnvelopes.push({ id, limit, used });
    }
  }
  const metric = await boundedCommand(colimaExecutable, ["--profile", profile, "ssh", "--", "cat", "/proc/meminfo", "/proc/sys/kernel/random/boot_id"], 2_000);
  const total = metric.stdout.match(/^MemTotal:\s+(\d+) kB$/m)?.[1];
  const available = metric.stdout.match(/^MemAvailable:\s+(\d+) kB$/m)?.[1];
  const boot = metric.stdout.trim().split("\n").at(-1);
  if (metric.code || !total || !available || !boot || !/^[a-f0-9-]{36}$/.test(boot)) throw new Error("sandbox_metrics_unavailable");
  return { daemonId: engine.id, bootId: boot, at: observedAt, totalBytes: Number(total) * 1024, availableBytes: Number(available) * 1024, serviceEnvelopes };
}

/** Used memory is already excluded by MemAvailable; subtract only future headroom. */
export function assertHostAdmission(host: HostObservation, now: number, excludeOwnedId?: string, profileId: string = SYNTHETIC_SMALL.id): void {
  const profile = profileId === SYNTHETIC_SMALL.id ? SYNTHETIC_SMALL : profileId === AV_PROFILE.id ? AV_PROFILE : null;
  if (!profile) throw new Error("sandbox_profile_invalid");
  if (!Number.isSafeInteger(now) || now < host.at || now - host.at > 2_000
    || !Number.isSafeInteger(host.totalBytes) || !Number.isSafeInteger(host.availableBytes)
    || host.availableBytes < 0 || host.availableBytes > host.totalBytes) throw new Error("sandbox_metrics_stale");
  const services = host.serviceEnvelopes.filter(s => s.id !== excludeOwnedId);
  if (services.some(s => !Number.isSafeInteger(s.limit) || s.limit <= 0 || !Number.isSafeInteger(s.used) || s.used < 0)) throw new Error("sandbox_service_envelope_unknown");
  const reserved = services.reduce((sum, s) => sum + s.limit, 0);
  const future = services.reduce((sum, s) => sum + Math.max(0, s.limit - s.used), 0);
  const ownedUsed = excludeOwnedId ? (host.serviceEnvelopes.find(s => s.id === excludeOwnedId)?.used ?? 0) : 0;
  const unconsumed = Math.max(0, profile.memoryBytes - ownedUsed);
  const safety = Math.max(1_073_741_824, Math.ceil(host.totalBytes / 4));
  if (reserved + safety + profile.memoryBytes > host.totalBytes
    || future + safety + unconsumed > host.availableBytes) throw new Error("sandbox_capacity_unavailable");
}

export async function observeWatchdogIdentity(docker: DockerClient, colimaExecutable: string, profile: string) {
  const info = await docker.command(["info", "--format", "{{.ID}}"], 750);
  const boot = await boundedCommand(colimaExecutable, ["--profile", profile, "ssh", "--", "cat", "/proc/sys/kernel/random/boot_id"], 750);
  if (info.code || !info.stdout.trim() || boot.code || !/^[a-f0-9-]{36}$/.test(boot.stdout.trim())) throw new Error("sandbox_watchdog_health_unavailable");
  await assertGuestDaemon(colimaExecutable, profile, info.stdout.trim());
  return { daemonId: info.stdout.trim(), bootId: boot.stdout.trim() };
}

async function assertGuestDaemon(executable: string, profile: string, expected: string): Promise<void> {
  const guest = await boundedCommand(executable, ["--profile", profile, "ssh", "--", "docker", "--host", "unix:///var/run/docker.sock", "info", "--format", "{{.ID}}"], 750);
  if (guest.code || guest.stdout.trim() !== expected) throw new Error("sandbox_metrics_daemon_mismatch");
}
