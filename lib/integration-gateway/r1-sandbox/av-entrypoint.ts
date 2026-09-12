import { constants } from "node:fs";
import { mkdtemp, open, rm, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { measurePinnedFile } from "../r1-upload/measure-pinned-file";
import { createReadonlyImageClamAvRunner } from "../r1-worker/clamav-process";
import { assertCvdFreshness, CLAMAV_IMAGE_PATHS, verifyReadonlyClamAvRuntime } from "../r1-worker/clamav-runtime-manifest";
import { AV_OUTPUT_BYTES, AV_PROTOCOL, avEvidenceSchema, avTerminalSchema, receiveAvInput, type AvHeader, type AvTerminal } from "./av-protocol";

/** Image-internal receiver. Configuration is trusted launch data, never job JSON.
 * No module-import side effects, path selectors, test runner or writable mode.
 * Returns protocol status only, not an accepted AV receipt (Packet C is required).
 */
export async function runAvEntrypoint(input: {
  stdin: Readable; stdout: Writable; expectedManifestSha256: string;
  remainingMs: number; signal: AbortSignal;
}): Promise<"terminal_written" | "no_result"> {
  if (!Number.isSafeInteger(input.remainingMs) || input.remainingMs < 1 || input.remainingMs > 300_000) return "no_result";
  const controller = new AbortController(); const started = performance.now();
  const abort = () => { controller.abort(); input.stdin.destroy(); input.stdout.destroy(); };
  input.signal.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, input.remainingMs);
  let directory: string | undefined; let writer: FileHandle | undefined; let reader: FileHandle | undefined;
  let header: AvHeader | undefined; let outputBytes = 0; let terminalStarted = false;
  const send = async (packet: unknown) => {
    controller.signal.throwIfAborted();
    const bytes = Buffer.from(`${JSON.stringify(packet)}\n`); outputBytes += bytes.length;
    if (outputBytes > AV_OUTPUT_BYTES) throw new Error("av_output_invalid");
    await new Promise<void>((resolve, reject) => {
      const fail = () => { cleanup(); reject(new Error("av_output_failed")); };
      const cleanup = () => { input.stdout.removeListener("error", fail); input.stdout.removeListener("close", fail); controller.signal.removeEventListener("abort", fail); };
      input.stdout.once("error", fail); input.stdout.once("close", fail); controller.signal.addEventListener("abort", fail, { once: true });
      input.stdout.write(bytes, error => { cleanup(); if (error) reject(new Error("av_output_failed")); else resolve(); });
    });
  };
  const cleanupFiles = async () => {
    if (writer) { await writer.close(); writer = undefined; }
    if (reader) { await reader.close(); reader = undefined; }
    if (directory) { await rm(directory, { recursive: true, force: true }); directory = undefined; }
  };
  try {
    if (input.signal.aborted) abort(); controller.signal.throwIfAborted();
    const runtime = await verifyReadonlyClamAvRuntime(input.expectedManifestSha256, input.remainingMs, controller.signal);
    await send({ protocol: AV_PROTOCOL, kind: "ready", runtimeManifestSha256: runtime.manifestSha256 });
    let position = 0;
    header = await receiveAvInput(input.stdin, async value => {
      header = value;
      directory = await mkdtemp(join(CLAMAV_IMAGE_PATHS.scratchDirectory, "r1-input-"));
      writer = await open(join(directory, "input"), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    }, async chunk => {
      let offset = 0;
      while (offset < chunk.length) {
        controller.signal.throwIfAborted();
        const { bytesWritten } = await writer!.write(chunk, offset, chunk.length - offset, position);
        if (!Number.isSafeInteger(bytesWritten) || bytesWritten < 1 || bytesWritten > chunk.length - offset) throw new Error("av_input_invalid");
        offset += bytesWritten; position += bytesWritten;
      }
    }, controller.signal);
    await writer!.close(); writer = undefined;
    reader = await open(join(directory!, "input"), constants.O_RDONLY | constants.O_NOFOLLOW);
    const measured = await measurePinnedFile({ file: reader, observedByteLength: header.byteLength, signal: controller.signal });
    if (measured.sourceSha256 !== header.sourceSha256) throw new Error("av_input_invalid");
    const remainingMs = Math.min(header.timeoutMs, Math.floor(input.remainingMs - (performance.now() - started)));
    if (remainingMs < 1) return "no_result";
    const result = await createReadonlyImageClamAvRunner(runtime.manifestSha256).run({ file: reader, byteLength: header.byteLength,
      checksumHex: header.sourceSha256, timeoutMs: remainingMs }, controller.signal);
    controller.signal.throwIfAborted();
    // A scanner deadline is absence of an admissible verdict, even when the
    // outer ingress budget is still live. Never serialize it as scan_failed.
    if (result.timedOut) return "no_result";
    const binding = { protocol: AV_PROTOCOL, runtimeManifestSha256: runtime.manifestSha256, nonce: header.nonce,
      sourceSha256: measured.sourceSha256, byteLength: measured.byteLength } as const;
    let terminal: AvTerminal = { ...binding, kind: "scan_failed", reason: "scan_incomplete" };
    if ((result.exitCode === 0 || result.exitCode === 1) && result.evidence) {
      const evidence = avEvidenceSchema.parse(result.evidence);
      if (evidence.sourceSha256 !== measured.sourceSha256 || evidence.byteLength !== measured.byteLength
        || evidence.runtimeManifestSha256 !== runtime.manifestSha256 || evidence.signatureBundleSha256 !== runtime.manifest.signatureBundleSha256
        || evidence.executableSha256 !== runtime.manifest.executable.sha256 || evidence.engineVersion !== runtime.manifest.executable.version
        || evidence.signatureVersion !== runtime.manifest.cvds["daily.cvd"].version
        || evidence.dailyTimestampSeconds !== runtime.manifest.cvds["daily.cvd"].timestampSeconds) throw new Error("av_evidence_invalid");
      assertCvdFreshness(evidence.dailyTimestampSeconds, Date.now(), 0);
      terminal = { ...binding, kind: "av_result", outcome: result.exitCode === 0 ? "clean" : "infected", nativeExitCode: result.exitCode, evidence };
    }
    await cleanupFiles(); controller.signal.throwIfAborted();
    terminalStarted = true; await send(avTerminalSchema.parse(terminal)); return "terminal_written";
  } catch {
    try {
      await cleanupFiles();
      if (!header || controller.signal.aborted || terminalStarted) return "no_result";
      terminalStarted = true;
      await send({ protocol: AV_PROTOCOL, kind: "scan_failed", runtimeManifestSha256: input.expectedManifestSha256,
        nonce: header.nonce, sourceSha256: header.sourceSha256, byteLength: header.byteLength, reason: "receiver_failed" });
      return "terminal_written";
    } catch { return "no_result"; }
  } finally {
    clearTimeout(timer); input.signal.removeEventListener("abort", abort);
    try { await cleanupFiles(); } catch { /* No success terminal can precede failed cleanup. */ }
  }
}
