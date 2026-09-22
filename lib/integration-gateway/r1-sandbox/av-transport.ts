import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { DockerClient } from "./docker";
import { AV_CHUNK_BYTES, AV_OUTPUT_BYTES, AvOutputDecoder, avReadySchema, encodeAvHeader, type AvHeader, type AvPacketObservation } from "./av-protocol";

export function assertSamePinnedFile(before: BigIntStats, after: BigIntStats): void {
  if (!before.isFile() || !after.isFile() || before.nlink !== 1n || after.nlink !== 1n
    || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mode !== after.mode
    || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs) throw new Error("sandbox_input_changed");
}

/** Second measured pass: bounded allocations, explicit offsets, borrowed FD.
 * The authority adapter must establish the broker pin and exclude writers.
 */
export async function* streamPinnedAvInput(input: { file: FileHandle; snapshot: BigIntStats; header: AvHeader; signal: AbortSignal }): AsyncGenerator<Buffer> {
  const { file, snapshot, header, signal } = input;
  signal.throwIfAborted(); assertSamePinnedFile(snapshot, await file.stat({ bigint: true }));
  if (snapshot.size !== BigInt(header.byteLength)) throw new Error("sandbox_input_changed");
  signal.throwIfAborted(); yield encodeAvHeader(header);
  const hash = createHash("sha256"); let position = 0;
  while (position < header.byteLength) {
    signal.throwIfAborted(); const chunk = Buffer.alloc(Math.min(AV_CHUNK_BYTES, header.byteLength - position));
    const { bytesRead } = await file.read(chunk, 0, chunk.length, position);
    if (!Number.isSafeInteger(bytesRead) || bytesRead < 1 || bytesRead > chunk.length) throw new Error("sandbox_input_changed");
    signal.throwIfAborted(); const bytes = chunk.subarray(0, bytesRead); position += bytesRead; hash.update(bytes); yield bytes;
  }
  signal.throwIfAborted();
  if ((await file.read(Buffer.alloc(1), 0, 1, position)).bytesRead !== 0) throw new Error("sandbox_input_changed");
  signal.throwIfAborted(); assertSamePinnedFile(snapshot, await file.stat({ bigint: true }));
  if (hash.digest("hex") !== header.sourceSha256) throw new Error("sandbox_input_changed");
  signal.throwIfAborted();
}

/** Attached CLI transport only, never daemon/AV authority. A successful CLI and
 * packet must still pass independent daemon wait/inspect, lease and cleanup. */
export async function streamAvToContainer(docker: DockerClient, input: {
  id: string; file: FileHandle; snapshot: BigIntStats; header: AvHeader;
  manifestSha256: string; timeoutMs: number; signal: AbortSignal;
}): Promise<AvPacketObservation> {
  if (!/^[a-f0-9]{64}$/.test(input.id) || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 300_000 || input.signal.aborted) return { kind: "no_result", reason: "invalid_protocol" };
  const connection = docker.config.context !== undefined ? ["--context", docker.config.context] : ["--host", docker.config.endpoint];
  const child = spawn(docker.config.executable, [...connection, "start", "--attach", "--interactive", input.id], {
    shell: false, env: { NODE_ENV: "production", HOME: homedir(), PATH: "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", LANG: "C", LC_ALL: "C" }, stdio: ["pipe", "pipe", "pipe"],
  });
  const controller = new AbortController(); const decoder = new AvOutputDecoder();
  let readyBytes = Buffer.alloc(0); let readySeen = false; let outputBytes = 0; let failed = false;
  let readyResolve!: () => void; let readyReject!: () => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = () => reject(new Error("sandbox_attachment_incomplete")); });
  const kill = () => { failed = true; controller.abort(); readyReject(); child.kill("SIGKILL"); };
  const timer = setTimeout(kill, input.timeoutMs); input.signal.addEventListener("abort", kill, { once: true });
  if (input.signal.aborted) kill();
  const collect = (channel: "stdout" | "stderr", bytes: Buffer) => {
    outputBytes += bytes.length;
    if (outputBytes > AV_OUTPUT_BYTES || (channel === "stderr" && bytes.length > 0)) { kill(); return; }
    decoder.push(channel, bytes);
    if (channel === "stdout" && !readySeen) {
      readyBytes = Buffer.concat([readyBytes, bytes]);
      const newline = readyBytes.indexOf(10);
      if (newline >= 0) {
        try {
          const packet = avReadySchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readyBytes.subarray(0, newline))));
          if (packet.runtimeManifestSha256 !== input.manifestSha256) throw new Error();
          readySeen = true; readyBytes = Buffer.alloc(0); readyResolve();
        } catch { kill(); }
      }
    }
  };
  child.stdout.on("data", bytes => collect("stdout", bytes)); child.stderr.on("data", bytes => collect("stderr", bytes));
  child.on("error", kill);
  const closed = new Promise<number | null>(resolve => child.once("close", code => { if (!readySeen) readyReject(); resolve(code); }));
  let reapTimer: ReturnType<typeof setTimeout> | undefined;
  const reapBound = new Promise<null>(resolve => controller.signal.addEventListener("abort", () => { reapTimer = setTimeout(() => resolve(null), 1000); }, { once: true }));
  const pump = (async () => {
    await ready;
    await pipeline(Readable.from(streamPinnedAvInput({ ...input, signal: controller.signal })), child.stdin, { signal: controller.signal });
  })().catch(() => { kill(); });
  try {
    const code = await Promise.race([closed, reapBound]);
    if (code !== 0) kill();
    await Promise.race([pump, reapBound]);
    if (failed || code !== 0 || input.signal.aborted) return { kind: "no_result", reason: "invalid_protocol" };
    return decoder.finish({ ...input.header, runtimeManifestSha256: input.manifestSha256 });
  } finally {
    clearTimeout(timer); if (reapTimer) clearTimeout(reapTimer);
    input.signal.removeEventListener("abort", kill);
  }
}
