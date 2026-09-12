import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import type { ExternalValidationJobInput } from "../r1-upload/adapters";
import { R1_UPLOAD_FORMATS, r1UploadFormatPolicy } from "../r1-upload/formats";
import { measurePinnedFile } from "../r1-upload/measure-pinned-file";
import { assertCvdFreshness, clamAvRuntimeManifestSchema } from "../r1-worker/clamav-runtime-manifest";
import { assertHostAdmission, observeLocalHost, observeWatchdogIdentity } from "./admission";
import { processGroup, type DockerClient } from "./docker";
import { cleanupOwned } from "./lifecycle";
import { AV_PROFILE, assertOwnedContainer, createArguments, expectedAvConfigDigest, type AvIntentMetadata, type SandboxIntent } from "./profile";
import type { SandboxRegistry } from "./registry";
import { avTerminalSchema, type AvTerminal } from "./av-protocol";
import { assertSamePinnedFile, streamAvToContainer } from "./av-transport";

export interface AvJobAuthority {
  /** Must prove the broker's immutable generation corresponds to this borrowed
   * readonly FD and exclude concurrent writers. A DTO declaration is not proof. */
  assertPinned(job: ExternalValidationJobInput, file: FileHandle, signal: AbortSignal): Promise<void>;
  /** Trusted application adapter: current durable fence/lease, scope, processing
   * entitlement and cancellation. No human impersonation or receipt writes. */
  assertCurrent(job: ExternalValidationJobInput, stage: "measurement" | "start" | "terminal" | "cleanup", signal: AbortSignal): Promise<void>;
}
export interface ApprovedAvRuntime {
  readonly imageId: string; readonly architecture: "arm64" | "amd64";
  readonly manifestSha256: string; readonly manifestBytes: Uint8Array;
}
export interface AvExecutorConfig {
  readonly docker: DockerClient; readonly registry: SandboxRegistry; readonly authority: AvJobAuthority;
  readonly colimaExecutable: string; readonly profile: string; readonly expectedDaemonId: string;
  /** Reviewed internal configuration, never a browser/job selector. */
  readonly runtime: ApprovedAvRuntime;
}
export type AvExecutionResult =
  | { readonly kind: "av_result"; readonly operationId: string; readonly jobBindingSha256: string; readonly cleanup: "settled"; readonly result: Extract<AvTerminal, { kind: "av_result" }> }
  | { readonly kind: "scan_failed"; readonly operationId: string; readonly cleanup: "settled"; readonly reason: string }
  | { readonly kind: "no_result"; readonly operationId?: string; readonly cleanup: "settled" | "pending" | "not_started"; readonly reason: "sandbox_av_incomplete" };

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => { abort = () => reject(new Error("sandbox_cancelled")); signal.addEventListener("abort", abort, { once: true }); });
  try { return await Promise.race([promise, stopped]); } finally { signal.removeEventListener("abort", abort); }
}

/** No public route, persistence or approval is performed here. Production use
 * still requires a real authority adapter, approved image/host and runtime proof. */
export async function runSandboxedClamAv(input: {
  readonly file: FileHandle; readonly job: ExternalValidationJobInput;
  readonly processingDeadlineMs: number; readonly signal: AbortSignal;
}, config: AvExecutorConfig): Promise<AvExecutionResult> {
  const started = Date.now(); const monotonic = performance.now();
  const controller = new AbortController(); const abort = () => controller.abort();
  input.signal.addEventListener("abort", abort, { once: true }); if (input.signal.aborted) abort();
  let timer: ReturnType<typeof setTimeout> | undefined; let pulse: ReturnType<typeof setInterval> | undefined;
  let operationId: string | undefined; let admitted = false; let terminal: AvTerminal | undefined;
  let intent: SandboxIntent | undefined; let jobBindingSha256 = "";
  try {
    // Snapshot authority data once. No lease capability enters the container/journal.
    const job = structuredClone(input.job);
    Object.freeze(job.scope); Object.freeze(job.pinnedObject.scope); Object.freeze(job.pinnedObject); Object.freeze(job);
    const deadline = Math.min(input.processingDeadlineMs, job.leaseExpiresAtMs);
    const remaining = () => {
      const now = Date.now(); const elapsed = performance.now() - monotonic;
      if (controller.signal.aborted || now >= deadline || elapsed >= deadline - started || Math.abs(now - started - elapsed) > 2_000) throw new Error("sandbox_cancelled");
      return Math.max(1, Math.floor(Math.min(deadline - now, deadline - started - elapsed)));
    };
    if (!Number.isSafeInteger(input.processingDeadlineMs) || !Number.isSafeInteger(job.leaseExpiresAtMs) || deadline <= started || deadline - started > AV_PROFILE.wallMs
      || !R1_UPLOAD_FORMATS.includes(job.requestedFormat) || !Number.isSafeInteger(job.observedLength) || job.observedLength < 1
      || job.observedLength > r1UploadFormatPolicy(job.requestedFormat).maxBytes || job.pinnedObject.observedLength !== job.observedLength
      || job.pinnedObject.generationId !== job.generationId || ["organizationId", "projectId", "packageId"].some(key => job.scope[key as keyof typeof job.scope] !== job.pinnedObject.scope[key as keyof typeof job.scope])) throw new Error("sandbox_job_invalid");
    timer = setTimeout(abort, remaining());
    const approved = Object.freeze({ ...config.runtime, manifestBytes: Buffer.from(config.runtime.manifestBytes) });
    if (!/^sha256:[a-f0-9]{64}$/.test(approved.imageId) || !["arm64", "amd64"].includes(approved.architecture)
      || approved.manifestBytes.length > 65_536 || !/^[a-f0-9]{64}$/.test(approved.manifestSha256)
      || createHash("sha256").update(approved.manifestBytes).digest("hex") !== approved.manifestSha256) throw new Error("sandbox_image_pin_invalid");
    const manifest = clamAvRuntimeManifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(approved.manifestBytes)));
    const fresh = () => { assertCvdFreshness(manifest.cvds["daily.cvd"].timestampSeconds, Date.now(), remaining()); };
    const current = async (stage: Parameters<AvJobAuthority["assertCurrent"]>[1]) => {
      remaining(); await abortable(config.authority.assertCurrent(job, stage, controller.signal), controller.signal); remaining();
    };
    await current("measurement"); fresh();
    const image = await abortable(config.docker.command(["image", "inspect", "--format", '{"id":{{json .Id}},"os":{{json .Os}},"arch":{{json .Architecture}},"user":{{json .Config.User}},"entrypoint":{{json .Config.Entrypoint}},"volumes":{{json .Config.Volumes}},"env":{{json .Config.Env}}}', approved.imageId], Math.min(5000, remaining()), controller.signal), controller.signal);
    const description = JSON.parse(image.stdout);
    if (image.code || description.id !== approved.imageId || description.os !== "linux" || description.arch !== approved.architecture
      || description.user !== "65532:65532" || JSON.stringify(description.entrypoint) !== '["/opt/r1/bin/node"]'
      || description.volumes === undefined || (description.volumes !== null && (typeof description.volumes !== "object" || Object.keys(description.volumes).length))
      || !Array.isArray(description.env) || description.env.some((v: unknown) => typeof v !== "string" || !/^(PATH|NODE_VERSION|LANG|LC_ALL|TMPDIR|NODE_ENV)=/.test(v))) throw new Error("sandbox_image_manifest_mismatch");
    const group = await abortable(processGroup(), controller.signal);
    const host = await abortable(observeLocalHost(config.docker, config.colimaExecutable, config.profile), controller.signal);
    if (host.daemonId !== config.expectedDaemonId) throw new Error("sandbox_host_identity_changed");
    operationId = randomUUID();
    jobBindingSha256 = createHash("sha256").update(JSON.stringify({ scope: job.scope, jobId: job.jobId, generationId: job.generationId, attempt: job.attempt, fence: job.fence })).digest("hex");
    const av: AvIntentMetadata = { version: "r1-av-config/v1", profileId: AV_PROFILE.id, protocol: "r1-av-wire/v1",
      architecture: approved.architecture, manifestSha256: approved.manifestSha256, receiverBudgetMs: remaining(), jobBindingSha256 };
    intent = { operationId, name: `r1-sandbox-${operationId}`, nonce: randomBytes(16).toString("hex"), fence: 1,
      daemonId: host.daemonId, bootId: host.bootId, imageId: approved.imageId, mode: "av", av,
      configDigest: expectedAvConfigDigest(approved.imageId, av), createdAt: started, deadline };
    const frozenIntent = intent;
    const identity = async () => {
      const observed = await abortable(observeWatchdogIdentity(config.docker, config.colimaExecutable, config.profile), controller.signal);
      if (observed.daemonId !== frozenIntent.daemonId || observed.bootId !== frozenIntent.bootId) throw new Error("sandbox_host_identity_changed");
      remaining();
    };
    const watchdog = () => config.registry.assertWatchdog(frozenIntent.daemonId, frozenIntent.bootId, Date.now(), process.pid, group);
    const admission = async () => {
      const observed = await abortable(observeLocalHost(config.docker, config.colimaExecutable, config.profile), controller.signal);
      if (observed.daemonId !== frozenIntent.daemonId || observed.bootId !== frozenIntent.bootId) throw new Error("sandbox_host_identity_changed");
      watchdog(); assertHostAdmission(observed, Date.now(), undefined, AV_PROFILE.id); remaining(); fresh();
    };
    await config.registry.admit(intent, admission); admitted = true;
    pulse = setInterval(() => {
      try {
        remaining(); watchdog(); const record = config.registry.read(frozenIntent.operationId);
        if (!record || !["measuring", "create_inflight", "created", "running"].includes(record.state) || record.cancelRequested) throw new Error("sandbox_cancelled");
        config.registry.cas(record, { supervisorHeartbeat: Date.now() });
      } catch { abort(); }
    }, 500);
    await abortable(config.authority.assertPinned(job, input.file, controller.signal), controller.signal);
    remaining(); const snapshot = await abortable(input.file.stat({ bigint: true }), controller.signal);
    const measurement = await abortable(measurePinnedFile({ file: input.file, observedByteLength: job.observedLength, signal: controller.signal }), controller.signal);
    remaining(); assertSamePinnedFile(snapshot, await abortable(input.file.stat({ bigint: true }), controller.signal));
    await current("start"); await admission();
    let record = config.registry.read(operationId);
    if (!record || record.state !== "measuring" || record.cancelRequested) throw new Error("sandbox_cancelled");
    config.registry.cas(record, { state: "create_inflight" });
    const created = await config.docker.command(createArguments(intent), Math.min(5000, remaining()), controller.signal);
    const id = created.stdout.trim(); if (created.code || !/^[a-f0-9]{64}$/.test(id)) throw new Error("sandbox_create_unsettled");
    record = config.registry.read(operationId); if (!record || record.state !== "create_inflight" || record.cancelRequested) throw new Error("sandbox_cancelled");
    config.registry.cas(record, { containerId: id, state: "created" });
    const inspected = await config.docker.inspect(id, Math.min(5000, remaining()));
    if (!inspected || inspected.Running) throw new Error("sandbox_container_missing"); assertOwnedContainer(intent, inspected, id);
    await current("start"); await admission();
    record = config.registry.read(operationId); if (!record || record.state !== "created" || record.cancelRequested) throw new Error("sandbox_cancelled");
    config.registry.cas(record, { state: "running" });
    const packet = await streamAvToContainer(config.docker, { id, file: input.file, snapshot,
      header: { ...measurement, nonce: intent.nonce, timeoutMs: remaining() }, manifestSha256: approved.manifestSha256,
      timeoutMs: remaining(), signal: controller.signal });
    if (packet.kind === "no_result") throw new Error("sandbox_attachment_incomplete");
    avTerminalSchema.parse(packet);
    if (packet.nonce !== intent.nonce || packet.runtimeManifestSha256 !== approved.manifestSha256
      || packet.sourceSha256 !== measurement.sourceSha256 || packet.byteLength !== measurement.byteLength) throw new Error("sandbox_evidence_mismatch");
    await identity();
    const waited = await config.docker.command(["wait", id], Math.min(5000, remaining()), controller.signal);
    const exited = await config.docker.inspect(id, Math.min(5000, remaining()));
    if (!exited) throw new Error("sandbox_exit_unconfirmed"); assertOwnedContainer(intent, exited, id);
    if (waited.code || waited.stdout.trim() !== "0" || exited.Running || exited.OOMKilled || exited.ExitCode !== 0) throw new Error("sandbox_exit_unconfirmed");
    await current("terminal"); fresh();
    if (packet.kind === "av_result" && (packet.nativeExitCode !== (packet.outcome === "clean" ? 0 : 1)
      || packet.evidence.sourceSha256 !== measurement.sourceSha256 || packet.evidence.byteLength !== measurement.byteLength
      || packet.evidence.runtimeManifestSha256 !== approved.manifestSha256 || packet.evidence.signatureBundleSha256 !== manifest.signatureBundleSha256
      || packet.evidence.engineVersion !== manifest.executable.version || packet.evidence.executableSha256 !== manifest.executable.sha256
      || packet.evidence.signatureVersion !== manifest.cvds["daily.cvd"].version || packet.evidence.dailyTimestampSeconds !== manifest.cvds["daily.cvd"].timestampSeconds)) throw new Error("sandbox_evidence_mismatch");
    terminal = packet;
    // Cleanup below must preserve late/failed outcomes and establish absence.
    if (pulse) { clearInterval(pulse); pulse = undefined; }
    const cleaned = await cleanupOwned(config.docker, config.registry, operationId);
    await current("cleanup"); await identity(); watchdog(); fresh();
    if (cleaned.state !== "settled" || cleaned.cancelRequested || cleaned.cleanupOutcome !== "timely" || cleaned.cleanupDeadlineMissedAt != null) throw new Error("sandbox_cleanup_unconfirmed");
    return terminal.kind === "av_result" ? { kind: "av_result", operationId, jobBindingSha256, cleanup: "settled", result: terminal }
      : { kind: "scan_failed", operationId, cleanup: "settled", reason: terminal.reason };
  } catch {
    if (pulse) { clearInterval(pulse); pulse = undefined; }
    let cleanup: "not_started" | "settled" | "pending" = admitted ? "pending" : "not_started";
    if (admitted && operationId) {
      try { const record = config.registry.read(operationId); if (record && !record.cancelRequested) config.registry.cas(record, { cancelRequested: true });
        cleanup = (await cleanupOwned(config.docker, config.registry, operationId)).state === "settled" ? "settled" : "pending";
      } catch { /* Reservation remains durable until verified absence/recovery. */ }
    }
    return { kind: "no_result", ...(operationId ? { operationId } : {}), cleanup, reason: "sandbox_av_incomplete" };
  } finally {
    if (pulse) clearInterval(pulse); if (timer) clearTimeout(timer); input.signal.removeEventListener("abort", abort);
  }
}
