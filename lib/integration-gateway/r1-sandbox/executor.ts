import { z } from "zod";
import { randomBytes, randomUUID } from "node:crypto";
import { assertHostAdmission, observeLocalHost } from "./admission";
import { processGroup, type DockerClient } from "./docker";
import { cleanupOwned } from "./lifecycle";
import { assertOwnedContainer, createArguments, expectedConfigDigest, SYNTHETIC_SMALL, PROBE_MODES, READONLY_CONTROL_MODE, type SandboxMode, type ProbeMode, type SandboxIntent } from "./profile";
import type { SandboxRegistry } from "./registry";

export interface SyntheticExecutorConfig {
  readonly docker: DockerClient; readonly registry: SandboxRegistry;
  readonly colimaExecutable: string; readonly profile: string;
  readonly expectedDaemonId: string; readonly imageId: string; readonly probeSourceSha256: string;
}
export interface SyntheticResult {
  readonly level: "synthetic-small-v1"; readonly operationId: string;
  readonly outcome: "completed" | "failed"; readonly cleanup: "settled" | "pending";
  readonly reason?: string; readonly runtime?: { readonly exitCode: number; readonly oomKilled: boolean }; readonly probe?: Record<string, unknown>;
}

async function assertImage(config: SyntheticExecutorConfig) {
  if (!/^sha256:[a-f0-9]{64}$/.test(config.imageId) || !/^[a-f0-9]{64}$/.test(config.probeSourceSha256)) throw new Error("sandbox_image_pin_invalid");
  const result = await config.docker.command(["image", "inspect", "--format", '{"id":{{json .Id}},"os":{{json .Os}},"arch":{{json .Architecture}},"user":{{json .Config.User}},"entrypoint":{{json .Config.Entrypoint}},"volumes":{{json (index .Config "Volumes")}},"env":{{json .Config.Env}},"labels":{{json .Config.Labels}}}', config.imageId]);
  const value = JSON.parse(result.stdout) as { id: string; os: string; arch: string; user: string; entrypoint: string[]; volumes: Record<string, unknown> | null; env: string[]; labels: Record<string, string> };
  if (result.code || value.id !== config.imageId || value.os !== "linux" || value.arch !== "arm64"
    || value.user !== "65532:65532" || JSON.stringify(value.entrypoint) !== '["/usr/local/bin/node"]'
    || Object.keys(value.volumes ?? {}).length || value.labels["r1.synthetic.source"] !== config.probeSourceSha256
    || value.env.some(v => !/^(PATH|NODE_VERSION|YARN_VERSION|LANG|LC_ALL|TMPDIR|NODE_ENV)=/.test(v))) throw new Error("sandbox_image_manifest_mismatch");
}

/** Executes only a fixed synthetic harness. Never returns AV/lineage/Gate 0 evidence. */
async function executeProbe(config: SyntheticExecutorConfig, mode: SandboxMode, signal: AbortSignal): Promise<Omit<SyntheticResult, "level"> & { readonly level: "synthetic-small-v1" | "synthetic-readonly-negative-control-v1" }> {
  await assertImage(config);
  const supervisorGroup = await processGroup();
  const host = await observeLocalHost(config.docker, config.colimaExecutable, config.profile);
  if (host.daemonId !== config.expectedDaemonId) throw new Error("sandbox_host_identity_changed");
  const createdAt = Date.now();
  const operationId = randomUUID();
  const intent: SandboxIntent = { operationId, nonce: randomBytes(16).toString("hex"), fence: 1,
    daemonId: host.daemonId, bootId: host.bootId, imageId: config.imageId, name: `r1-sandbox-${operationId}`,
    configDigest: expectedConfigDigest(config.imageId, mode), mode, createdAt, deadline: createdAt + SYNTHETIC_SMALL.wallMs };
  await config.registry.admit(intent, async () => {
    const fresh = await observeLocalHost(config.docker, config.colimaExecutable, config.profile);
    if (fresh.daemonId !== intent.daemonId || fresh.bootId !== intent.bootId) throw new Error("sandbox_host_identity_changed");
    config.registry.assertWatchdog(intent.daemonId, intent.bootId, Date.now(), process.pid, supervisorGroup);
    assertHostAdmission(fresh, Date.now());
    if (signal.aborted) throw new Error("sandbox_cancelled");
  });
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const monotonicStart = performance.now();
  const heartbeatStart = Date.now();
  const pulse = setInterval(() => {
    try {
      if (Math.abs(Date.now() - heartbeatStart - (performance.now() - monotonicStart)) > 2_000) throw new Error("clock_discontinuity");
      config.registry.assertWatchdog(intent.daemonId, intent.bootId, Date.now(), process.pid, supervisorGroup);
      const current = config.registry.read(operationId);
      if (!current || !["create_inflight", "created", "running"].includes(current.state) || current.cancelRequested || Date.now() >= intent.deadline) throw new Error("sandbox_cancelled");
      config.registry.cas(current, { supervisorHeartbeat: Date.now() });
    } catch { controller.abort(); }
  }, 500);
  let probe: Record<string, unknown> | undefined;
  let success = false;
  let failureReason = "sandbox_execution_failed";
  let runtime: { exitCode: number; oomKilled: boolean } | undefined;
  try {
    if (signal.aborted) controller.abort();
    if (controller.signal.aborted || Date.now() >= intent.deadline) throw new Error("sandbox_cancelled");
    const created = await config.docker.command(createArguments(intent), Math.min(5_000, intent.deadline - Date.now()), controller.signal);
    const id = created.stdout.trim();
    if (created.code || !/^[a-f0-9]{64}$/.test(id)) throw new Error("sandbox_create_unsettled");
    let current = config.registry.read(operationId);
    if (!current) throw new Error("sandbox_intent_missing");
    config.registry.cas(current, { containerId: id, state: "created" });
    const inspected = await config.docker.inspect(id);
    if (!inspected) throw new Error("sandbox_container_missing");
    assertOwnedContainer(intent, inspected, id);
    const beforeStart = await observeLocalHost(config.docker, config.colimaExecutable, config.profile);
    if (beforeStart.daemonId !== intent.daemonId || beforeStart.bootId !== intent.bootId) throw new Error("sandbox_host_identity_changed");
    assertHostAdmission(beforeStart, Date.now());
    config.registry.assertWatchdog(intent.daemonId, intent.bootId, Date.now(), process.pid, supervisorGroup);
    current = config.registry.read(operationId);
    if (!current || current.state !== "created" || current.cancelRequested || controller.signal.aborted) throw new Error("sandbox_cancelled");
    config.registry.cas(current, { state: "running" });
    const run = await config.docker.command(["start", "--attach", id], Math.max(1, intent.deadline - Date.now()), controller.signal);
    const final = await config.docker.inspect(id);
    if (!final) throw new Error("sandbox_exit_unconfirmed");
    assertOwnedContainer(intent, final, id);
    runtime = { exitCode: final.ExitCode, oomKilled: final.OOMKilled };
    if (run.code || final.Running || final.OOMKilled || final.ExitCode || Date.now() >= intent.deadline || controller.signal.aborted) throw new Error("sandbox_probe_failed");
    probe = (mode === READONLY_CONTROL_MODE ? readonlyControlSchema : probeResultSchema).parse(JSON.parse(run.stdout));
    if (probe.level !== (mode === READONLY_CONTROL_MODE ? "synthetic-readonly-negative-control-v1" : "synthetic-small-v1") || probe.mode !== mode || probe.ok !== true) throw new Error("sandbox_probe_result_invalid");
    success = true;
  } catch (error) {
    success = false;
    if (error instanceof Error && /^sandbox_[a-z_]+$/.test(error.message)) failureReason = error.message;
  }
  finally { clearInterval(pulse); signal.removeEventListener("abort", abort); }
  const cleaned = await cleanupOwned(config.docker, config.registry, operationId);
  success = success && cleaned.cleanupDeadlineMissedAt == null && cleaned.cleanupOutcome !== "late" && !cleaned.cancelRequested && !signal.aborted && !controller.signal.aborted && Date.now() < intent.deadline;
  return { level: mode === READONLY_CONTROL_MODE ? "synthetic-readonly-negative-control-v1" : "synthetic-small-v1", operationId, outcome: success && cleaned.state === "settled" ? "completed" : "failed",
    cleanup: cleaned.state === "settled" ? "settled" : "pending", ...(runtime ? { runtime } : {}), ...(probe ? { probe } : {}), ...(!success || cleaned.state !== "settled" ? { reason: failureReason } : {}) };
}

const probeResultSchema = z.object({
  level: z.literal("synthetic-small-v1"), mode: z.enum(["observe", "cpu", "pids", "memory", "wait"]), ok: z.boolean(),
  evidence: z.object({ uid: z.literal(65532), gid: z.literal(65532), rootfsWriteError: z.literal("EROFS"),
    status: z.object({ CapEff: z.literal("0000000000000000"), NoNewPrivs: z.literal("1"), Seccomp: z.literal("2") }).strict(),
    cpuMax: z.literal("100000 100000"), memoryMax: z.literal("268435456"), swapMax: z.literal("0"), pidsMax: z.literal("32"),
  }).strict(),
  childrenStarted: z.number().int().nonnegative().max(32).optional(),
  pidLimitEvents: z.number().int().nonnegative().optional(),
  throttledPeriods: z.number().int().nonnegative().optional(),
}).strict();

const readonlyControlSchema = z.object({
  level: z.literal("synthetic-readonly-negative-control-v1"), mode: z.literal(READONLY_CONTROL_MODE), ok: z.literal(true),
  negativeEvidence: z.object({ uid: z.literal(65532), writeSucceeded: z.literal(true) }).strict(),
}).strict();

/** Normal execution always requires read-only root. The control is not a ProbeMode. */
export async function runSyntheticProbe(config: SyntheticExecutorConfig, mode: ProbeMode, signal: AbortSignal): Promise<SyntheticResult> {
  if (!PROBE_MODES.includes(mode)) throw new Error("sandbox_probe_mode_invalid");
  const result = await executeProbe(config, mode, signal);
  if (result.level !== "synthetic-small-v1") throw new Error("sandbox_probe_mode_invalid");
  return { ...result, level: "synthetic-small-v1" };
}

/** Fixed diagnostic only: no source/bytes/input argument, no positive OS/AV receipt. */
export async function runReadonlyNegativeControl(config: SyntheticExecutorConfig, signal: AbortSignal) {
  const keys = ["docker", "registry", "colimaExecutable", "profile", "expectedDaemonId", "imageId", "probeSourceSha256"];
  if (arguments.length !== 2 || Object.keys(config).some(key => !keys.includes(key))) throw new Error("sandbox_control_input_forbidden");
  const result = await executeProbe(config, READONLY_CONTROL_MODE, signal);
  return { level: "synthetic-readonly-negative-control-v1" as const, operationId: result.operationId,
    outcome: result.outcome === "completed" ? "negative_control_observed" as const : "failed" as const,
    cleanup: result.cleanup,
    ...(result.outcome === "completed" && result.probe ? { negativeEvidence: readonlyControlSchema.parse(result.probe).negativeEvidence } : {}) };
}
