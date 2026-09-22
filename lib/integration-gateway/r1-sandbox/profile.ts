import { createHash } from "node:crypto";
import { R1_WORKER_LIMITS } from "../r1-worker/policy";

export const SYNTHETIC_SMALL = Object.freeze({
  id: "synthetic-small-v1", memoryBytes: 268_435_456, scratchBytes: 67_108_864,
  shmBytes: 8_388_608, cpus: 1, pids: 32, wallMs: 60_000, outputBytes: 65_536,
});
export const AV_PROFILE = Object.freeze({
  id: "clamav-v1", memoryBytes: 3_221_225_472, scratchBytes: 805_306_368,
  shmBytes: 16_777_216, cpus: 1, pids: 64, wallMs: R1_WORKER_LIMITS.wallTimeSeconds * 1000, outputBytes: 65_536,
});
export interface AvIntentMetadata {
  readonly version: "r1-av-config/v1"; readonly profileId: "clamav-v1";
  readonly protocol: "r1-av-wire/v1"; readonly manifestSha256: string;
  readonly architecture: "arm64" | "amd64"; readonly receiverBudgetMs: number;
  readonly jobBindingSha256: string;
}
export const PROBE_MODES = ["observe", "cpu", "pids", "memory", "wait"] as const;
export type ProbeMode = (typeof PROBE_MODES)[number];
export const READONLY_CONTROL_MODE = "readonly-negative-control" as const;
export type SandboxMode = ProbeMode | typeof READONLY_CONTROL_MODE | "av";
export interface SandboxIntent {
  readonly operationId: string; readonly nonce: string; readonly fence: number;
  readonly daemonId: string; readonly bootId: string; readonly imageId: string;
  readonly name: string; readonly configDigest: string; readonly createdAt: number;
  readonly deadline: number; readonly mode: SandboxMode; readonly av?: AvIntentMetadata;
}
export function expectedConfigDigest(imageId: string, mode: SandboxMode): string {
  return createHash("sha256").update(JSON.stringify({ imageId, mode, profile: SYNTHETIC_SMALL, readonlyRoot: mode !== READONLY_CONTROL_MODE })).digest("hex");
}
/** Historical synthetic digest preimage above is unchanged. AV rows use v1. */
export function expectedAvConfigDigest(imageId: string, av: AvIntentMetadata): string {
  return createHash("sha256").update(JSON.stringify({ version: "r1-av-config/v1", imageId, av, profile: AV_PROFILE, readonlyRoot: true })).digest("hex");
}
export function intentProfile(intent: Pick<SandboxIntent, "mode" | "av">) {
  if (intent.mode === "av") {
    const av = intent.av;
    if (!av || Object.keys(av).sort().join(",") !== "architecture,jobBindingSha256,manifestSha256,profileId,protocol,receiverBudgetMs,version"
      || av.version !== "r1-av-config/v1" || av.profileId !== AV_PROFILE.id || av.protocol !== "r1-av-wire/v1"
      || !["arm64", "amd64"].includes(av.architecture) || !/^[a-f0-9]{64}$/.test(av.manifestSha256)
      || !/^[a-f0-9]{64}$/.test(av.jobBindingSha256) || !Number.isSafeInteger(av.receiverBudgetMs) || av.receiverBudgetMs < 1 || av.receiverBudgetMs > AV_PROFILE.wallMs) throw new Error("sandbox_profile_invalid");
    return AV_PROFILE;
  }
  if (intent.av !== undefined || (!PROBE_MODES.includes(intent.mode as ProbeMode) && intent.mode !== READONLY_CONTROL_MODE)) throw new Error("sandbox_profile_invalid");
  return SYNTHETIC_SMALL;
}
function runtimeCommand(intent: SandboxIntent) {
  intentProfile(intent);
  return intent.mode === "av"
    ? { entrypoint: "/opt/r1/bin/node", command: ["/opt/r1/av-entrypoint.cjs", "--manifest-sha256", intent.av!.manifestSha256, "--remaining-ms", String(intent.av!.receiverBudgetMs)] }
    : { entrypoint: "/usr/local/bin/node", command: ["/opt/r1/probe.mjs", intent.mode] };
}
export function labels(intent: SandboxIntent): Record<string, string> {
  return { "r1.sandbox.operation": intent.operationId, "r1.sandbox.nonce": intent.nonce,
    "r1.sandbox.fence": String(intent.fence), "r1.sandbox.config": intent.configDigest };
}
export function createArguments(intent: SandboxIntent): string[] {
  const profile = intentProfile(intent); const runtime = runtimeCommand(intent);
  if (intent.configDigest !== (intent.av ? expectedAvConfigDigest(intent.imageId, intent.av) : expectedConfigDigest(intent.imageId, intent.mode))) throw new Error("sandbox_config_invalid");
  if (!/^sha256:[a-f0-9]{64}$/.test(intent.imageId) || (intent.mode !== "av" && !PROBE_MODES.some(mode => mode === intent.mode) && intent.mode !== READONLY_CONTROL_MODE)
    || !/^r1-sandbox-[a-f0-9-]{36}$/.test(intent.name)) throw new Error("sandbox_intent_invalid");
  return ["create", "--pull=never", "--name", intent.name, ...Object.entries(labels(intent)).flatMap(([key, value]) => ["--label", `${key}=${value}`]),
    "--restart=no", "--no-healthcheck", "--log-driver=none", "--init", "--interactive",
    "--user=65532:65532", "--cap-drop=ALL", "--security-opt=no-new-privileges", "--cgroupns=private", "--ipc=private",
    "--network=none", ...(intent.mode === READONLY_CONTROL_MODE ? [] : ["--read-only"]), "--cpus=1", `--memory=${profile.memoryBytes}`,
    `--memory-swap=${profile.memoryBytes}`, `--pids-limit=${profile.pids}`,
    `--shm-size=${profile.shmBytes}`, "--ulimit=nofile=256:256", "--ulimit=core=0:0",
    `--tmpfs=/scratch:rw,nosuid,nodev,noexec,size=${profile.scratchBytes},mode=0700,uid=65532,gid=65532`,
    "--workdir=/scratch", `--entrypoint=${runtime.entrypoint}`, intent.imageId, ...runtime.command];
}

export interface ContainerObservation {
  Id: string; Image: string; Name: string; Labels: Record<string, string>;
  User: string; Entrypoint: string[]; Cmd: string[]; Running: boolean; OOMKilled: boolean; ExitCode: number;
  HostConfig: { ReadonlyRootfs: boolean; NetworkMode: string; Privileged: boolean; CapDrop: string[] | null;
    CapAdd: string[] | null; SecurityOpt: string[] | null; Memory: number; MemorySwap: number; NanoCpus: number;
    PidsLimit: number; ShmSize: number; Tmpfs: Record<string, string>; Binds: string[] | null;
    Mounts?: unknown[]; Devices: unknown[] | null; PidMode: string; IpcMode: string; CgroupnsMode: string;
    Init: boolean; LogConfig: { Type: string }; RestartPolicy: { Name: string }; PortBindings: Record<string, unknown> | null;
    Ulimits: { Name: string; Soft: number; Hard: number }[] };
  Mounts: { Type: string; Destination: string }[];
}
export function assertOwnedContainer(intent: SandboxIntent, c: ContainerObservation, expectedId?: string): void {
  const profile = intentProfile(intent); const runtime = runtimeCommand(intent);
  if (intent.mode === "av" && intent.configDigest !== expectedAvConfigDigest(intent.imageId, intent.av!)) throw new Error("sandbox_ownership_conflict");
  if (!c || !c.HostConfig || !c.Labels || typeof c.Labels !== "object" || !Array.isArray(c.Mounts)) throw new Error("sandbox_ownership_conflict");
  if (typeof c.Running !== "boolean" || typeof c.OOMKilled !== "boolean" || !Number.isSafeInteger(c.ExitCode) || c.ExitCode < 0 || c.ExitCode > 255) throw new Error("sandbox_ownership_conflict");
  const h = c.HostConfig;
  if (!Array.isArray(h.SecurityOpt) || !Array.isArray(h.Ulimits) || h.PortBindings === undefined || (h.PortBindings !== null && (typeof h.PortBindings !== "object" || Array.isArray(h.PortBindings)))) throw new Error("sandbox_ownership_conflict");
  const expectedTmpfs = `rw,nosuid,nodev,noexec,size=${profile.scratchBytes},mode=0700,uid=65532,gid=65532`;
  const empty = (value: unknown[] | null | undefined) => value === null || (Array.isArray(value) && value.length === 0);
  if (!/^[a-f0-9]{64}$/.test(c.Id) || (expectedId && c.Id !== expectedId) || c.Image !== intent.imageId
    || c.Name !== `/${intent.name}` || Object.entries(labels(intent)).some(([key, value]) => c.Labels[key] !== value)
    || c.User !== "65532:65532" || JSON.stringify(c.Entrypoint) !== JSON.stringify([runtime.entrypoint])
    || JSON.stringify(c.Cmd) !== JSON.stringify(runtime.command)
    || h.ReadonlyRootfs !== (intent.mode !== READONLY_CONTROL_MODE) || h.NetworkMode !== "none" || h.Privileged !== false || h.Init !== true
    || JSON.stringify(h.CapDrop) !== '["ALL"]' || !empty(h.CapAdd)
    || !h.SecurityOpt?.includes("no-new-privileges") || h.SecurityOpt.some(option => option.includes("unconfined"))
    || h.Memory !== profile.memoryBytes || h.MemorySwap !== profile.memoryBytes
    || h.NanoCpus !== 1_000_000_000 || h.PidsLimit !== profile.pids || h.ShmSize !== profile.shmBytes
    || h.Tmpfs?.["/scratch"] !== expectedTmpfs || Object.keys(h.Tmpfs ?? {}).length !== 1
    || !empty(h.Binds) || (h.Mounts !== undefined && !empty(h.Mounts)) || !empty(h.Devices) || c.Mounts.some(m => m.Type !== "tmpfs")
    || h.PidMode !== "" || h.IpcMode !== "private" || h.CgroupnsMode !== "private"
    || h.LogConfig.Type !== "none" || h.RestartPolicy.Name !== "no" || Object.keys(h.PortBindings ?? {}).length
    || !h.Ulimits.some(u => u.Name === "nofile" && u.Soft === 256 && u.Hard === 256)
    || !h.Ulimits.some(u => u.Name === "core" && u.Soft === 0 && u.Hard === 0)) throw new Error("sandbox_ownership_conflict");
}
