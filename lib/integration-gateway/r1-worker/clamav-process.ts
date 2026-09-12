import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import type { BigIntStats } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, realpath, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { R1ClamAvInvocation, R1ClamAvRunner } from "./clamav-adapter";
import { assertVerifiedReadonlyClamAvRuntime, CLAMAV_IMAGE_PATHS, CLAMAV_SIGNATURE_MAX_AGE_SECONDS, verifyReadonlyClamAvRuntime, type VerifiedReadonlyClamAvRuntime } from "./clamav-runtime-manifest";

export interface ClamAvProcessConfig {
  /** Trusted worker configuration; never values from a browser or queue payload. */
  readonly executable: string;
  readonly executableSha256: string;
  readonly databaseDirectory: string;
  readonly scratchDirectory: string;
}

export interface ClamAvProcessResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly reason?: string;
  readonly evidence?: {
    readonly engineVersion: string;
    readonly signatureVersion: number;
    readonly signatureBundleSha256: string;
    readonly sourceSha256: string;
    readonly byteLength: number;
    readonly runtimeManifestSha256?: string;
    readonly executableSha256?: string;
    readonly dailyTimestampSeconds?: number;
    readonly scannerPolicyVersion?: string;
  };
}

const maxOutputBytes = 65_536;
const chunkBytes = 65_536;
const maxExecutableBytes = 100_000_000n;
const maxSignatureAgeSeconds = CLAMAV_SIGNATURE_MAX_AGE_SECONDS;
const failure = (timedOut = false, reason = "scan_incomplete"): ClamAvProcessResult => ({ exitCode: null, timedOut, reason });

async function digestFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.isFile() && right.isFile() && left.dev === right.dev && left.ino === right.ino
    && left.size === right.size && left.mode === right.mode && left.nlink === right.nlink
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

/** Local process adapter. Production must additionally supply the OS sandbox
 * required by MASTER 5.3 (network denial and CPU/RAM/read-only runtime limits).
 * This implementation is exercised only on synthetic files until that gate. */
interface EvidenceRunner extends R1ClamAvRunner {
  run(input: R1ClamAvInvocation, signal: AbortSignal): Promise<ClamAvProcessResult>;
}

export function createClamAvProcessRunner(config: ClamAvProcessConfig): EvidenceRunner {
  return createRunner(config);
}

/** No caller-selected path/mode can bypass actual readonly image verification.
 * Host OCI pinning, job authority and the Docker transport remain separate gates.
 */
export function createReadonlyImageClamAvRunner(expectedManifestSha256: string): EvidenceRunner {
  return { async run(input, outerSignal) {
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 300_000) return failure();
    const controller = new AbortController(); const abort = () => controller.abort();
    outerSignal.addEventListener("abort", abort, { once: true });
    if (outerSignal.aborted) abort();
    const started = performance.now(); const timer = setTimeout(abort, input.timeoutMs);
    try {
      const runtime = await verifyReadonlyClamAvRuntime(expectedManifestSha256, input.timeoutMs, controller.signal);
      const remaining = Math.floor(input.timeoutMs - (performance.now() - started));
      if (remaining < 1 || controller.signal.aborted) return failure(true, "readonly_runtime_deadline");
      const result = await createRunner({ executable: CLAMAV_IMAGE_PATHS.executable, executableSha256: runtime.manifest.executable.sha256,
        databaseDirectory: CLAMAV_IMAGE_PATHS.databaseDirectory, scratchDirectory: CLAMAV_IMAGE_PATHS.scratchDirectory }, runtime)
        .run({ ...input, timeoutMs: remaining }, controller.signal);
      return controller.signal.aborted ? failure(true, "readonly_runtime_deadline") : result;
    } catch { return failure(controller.signal.aborted, "readonly_runtime_unavailable"); }
    finally { clearTimeout(timer); outerSignal.removeEventListener("abort", abort); }
  } };
}

function createRunner(config: ClamAvProcessConfig, readonlyRuntime?: VerifiedReadonlyClamAvRuntime): EvidenceRunner {
  return {
    async run(input, outerSignal): Promise<ClamAvProcessResult> {
      if (![config.executable, config.databaseDirectory, config.scratchDirectory].every(isAbsolute)
        || !/^[a-f0-9]{64}$/.test(config.executableSha256)
        || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 300_000
        || !Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > 100_000_000
        || !/^[a-f0-9]{64}$/.test(input.checksumHex) || !['darwin', 'linux'].includes(process.platform)) return failure();

      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      outerSignal.addEventListener('abort', abort, { once: true });
      if (outerSignal.aborted) abort();
      const timer = setTimeout(() => { timedOut = true; abort(); }, input.timeoutMs);
      let scratch: string | undefined;
      let executableDirectory: string | undefined;
      let phase = "verify_executable";
      try {
        const { signal } = controller;
        signal.throwIfAborted();
        // The package-manager path may be replaced after verification. Copy
        // through one descriptor, then verify and execute only our private copy.
        // Worker UID/root and runtime libraries remain trusted (MASTER 5.3).
        scratch = await mkdtemp(join(config.scratchDirectory, 'r1-av-'));
        let executablePath: string;
        let executableUnchanged: () => Promise<boolean>;
        if (readonlyRuntime) {
          assertVerifiedReadonlyClamAvRuntime(readonlyRuntime);
          executablePath = CLAMAV_IMAGE_PATHS.executable;
          const pinned = await lstat(executablePath, { bigint: true });
          if (!pinned.isFile() || pinned.nlink !== 1n || !(pinned.mode & 0o111n)
            || await realpath(executablePath) !== executablePath
            || await digestFile(executablePath, signal) !== config.executableSha256) return failure(false, phase);
          executableUnchanged = async () => await realpath(executablePath) === executablePath
            && sameFile(pinned, await lstat(executablePath, { bigint: true }));
        } else {
          executableDirectory = join(scratch, 'runtime');
          await mkdir(executableDirectory, { mode: 0o700 });
          executablePath = join(executableDirectory, 'clamscan');
          const installedPath = await realpath(config.executable);
          const installed = await open(installedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
          let installedStat: BigIntStats;
          try {
            installedStat = await installed.stat({ bigint: true });
            if (!installedStat.isFile() || installedStat.nlink !== 1n || !(installedStat.mode & 0o111n)
              || installedStat.size < 1n || installedStat.size > maxExecutableBytes) return failure(false, phase);
            const snapshot = await open(executablePath, 'wx', 0o600);
            try {
              let offset = 0;
              const size = Number(installedStat.size);
              while (offset < size) {
                signal.throwIfAborted();
                const buffer = Buffer.alloc(Math.min(chunkBytes, size - offset));
                const { bytesRead } = await installed.read(buffer, 0, buffer.length, offset);
                if (!bytesRead) return failure(false, phase);
                await snapshot.writeFile(buffer.subarray(0, bytesRead));
                offset += bytesRead;
              }
            } finally { await snapshot.close(); }
            if (!sameFile(installedStat, await installed.stat({ bigint: true }))) return failure(false, phase);
          } finally { await installed.close(); }
          if (await digestFile(executablePath, signal) !== config.executableSha256) return failure(false, phase);
          await chmod(executablePath, 0o500);
          await chmod(executableDirectory, 0o500);
          const executableStat = await lstat(executablePath, { bigint: true });
          executableUnchanged = async () => (
            await realpath(config.executable) === installedPath
            && sameFile(installedStat, await lstat(installedPath, { bigint: true }))
            && sameFile(executableStat, await lstat(executablePath, { bigint: true }))
          );
        }
        phase = "verify_input";
        const initial = await input.file.stat({ bigint: true });
        if (!initial.isFile() || initial.size !== BigInt(input.byteLength) || initial.nlink !== 1n) return failure(false, phase);

        phase = "verify_signatures";
        const databasePaths = ['main.cvd', 'daily.cvd', 'bytecode.cvd'].map(name => join(config.databaseDirectory, name));
        const databaseStats = await Promise.all(databasePaths.map(path => lstat(path, { bigint: true })));
        if (databaseStats.some(stat => !stat.isFile() || stat.nlink !== 1n)) return failure(false, phase);
        const bundle = createHash('sha256');
        for (const path of databasePaths) bundle.update(await digestFile(path, signal));
        const signatureBundleSha256 = bundle.digest('hex');
        if (readonlyRuntime && signatureBundleSha256 !== readonlyRuntime.manifest.signatureBundleSha256) return failure(false, phase);
        phase = "verify_freshness";
        const daily = await open(join(config.databaseDirectory, 'daily.cvd'), 'r');
        let signatureVersion: number;
        try {
          const header = Buffer.alloc(512);
          const { bytesRead } = await daily.read(header, 0, 512, 0);
          const fields = header.toString('ascii').trim().split(':');
          signatureVersion = Number(fields[2]);
          const age = Date.now() / 1000 - Number(fields[8]);
          if (bytesRead !== 512 || fields.length !== 9 || fields[0] !== 'ClamAV-VDB'
            || !Number.isSafeInteger(signatureVersion) || signatureVersion < 1
            || !Number.isFinite(age) || age < -300 || age > maxSignatureAgeSeconds) return failure(false, phase);
        } finally { await daily.close(); }

        signal.throwIfAborted();
        const args = [
          ...databasePaths.map(path => `--database=${path}`),
          // Freshness is checked on daily.cvd above. With separate -d files,
          // ClamAV's age flag rejects the intentionally long-lived main.cvd.
          '--official-db-only=yes', '--bytecode-unsigned=no',
          '--alert-exceeds-max=yes', '--alert-encrypted=yes', '--alert-broken=yes', '--alert-broken-media=yes',
          '--max-filesize=100000000', '--max-scansize=500000000', '--max-files=2000',
          '--max-recursion=2', '--max-scantime=0', '--follow-file-symlinks=0', '--follow-dir-symlinks=0',
          `--tempdir=${scratch}`, '-',
        ];
        if (!await executableUnchanged()) return failure(false, 'executable_changed');
        signal.throwIfAborted();
        phase = "execute_scanner";
        const child = spawn(executablePath, args, {
          shell: false, detached: true, cwd: scratch,
          env: { NODE_ENV: 'production', LANG: 'C', LC_ALL: 'C', TMPDIR: scratch },
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const kill = () => {
          if (child.pid) {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          }
        };
        signal.addEventListener('abort', kill, { once: true });
        if (signal.aborted) kill();
        let outputBytes = 0;
        let output = '';
        let overflow = false;
        const collect = (chunk: Buffer) => {
          outputBytes += chunk.length;
          if (outputBytes > maxOutputBytes) { overflow = true; kill(); return; }
          output += chunk.toString('utf8');
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        const closed = new Promise<number | null>(resolve => {
          child.on('error', () => resolve(null));
          child.on('close', code => resolve(code));
        });
        const hash = createHash('sha256');
        let bytes = 0;
        async function* source() {
          // Explicit offsets make a prior read of the borrowed descriptor safe.
          while (bytes < input.byteLength) {
            signal.throwIfAborted();
            const buffer = Buffer.alloc(Math.min(chunkBytes, input.byteLength - bytes));
            const { bytesRead } = await input.file.read(buffer, 0, buffer.length, bytes);
            if (!bytesRead) throw new Error('scan_input_truncated');
            bytes += bytesRead;
            const chunk = buffer.subarray(0, bytesRead);
            hash.update(chunk);
            yield chunk;
          }
          const extra = Buffer.alloc(1);
          if ((await input.file.read(extra, 0, 1, bytes)).bytesRead) throw new Error('scan_input_grew');
        }
        let streamFailed = false;
        const feeding = pipeline(Readable.from(source()), child.stdin, { signal }).catch(() => {
          streamFailed = true;
          kill();
        });
        let exitCode: number | null;
        try { [exitCode] = await Promise.all([closed, feeding]); }
        finally { signal.removeEventListener('abort', kill); }
        if (signal.aborted || overflow || streamFailed || bytes !== input.byteLength) return failure(timedOut || outerSignal.aborted);
        if (!await executableUnchanged()) return failure(false, 'executable_changed');
        const sourceSha256 = hash.digest('hex');
        if (sourceSha256 !== input.checksumHex) return failure(false, phase);
        const final = await input.file.stat({ bigint: true });
        if (final.size !== initial.size || final.mtimeNs !== initial.mtimeNs || final.ctimeNs !== initial.ctimeNs) return failure(false, phase);
        for (const [index, path] of databasePaths.entries()) {
          const stat = await lstat(path, { bigint: true });
          const prior = databaseStats[index];
          if (!prior || stat.ino !== prior.ino || stat.size !== prior.size || stat.mtimeNs !== prior.mtimeNs || stat.ctimeNs !== prior.ctimeNs) return failure(false, phase);
        }
        // Never expose raw diagnostics. Exit zero alone can mean a skipped scan.
        if (/\b(?:ERROR|WARNING)\b/i.test(output) || !/^Known viruses: [1-9]\d*$/m.test(output)
          || !/^Scanned files: [1-9]\d*$/m.test(output)) return failure(false, phase);
        if (exitCode === 0 && (!/^stdin: OK$/m.test(output) || !/^Infected files: 0$/m.test(output))) return failure(false, phase);
        if (exitCode === 1 && !/^Infected files: [1-9]\d*$/m.test(output)) return failure(false, phase);
        if (exitCode !== 0 && exitCode !== 1) return failure(false, phase);
        const engineVersion = output.match(/^Engine version: (\d+\.\d+\.\d+)$/m)?.[1];
        if (!engineVersion || (readonlyRuntime && engineVersion !== readonlyRuntime.manifest.executable.version)) return failure(false, phase);
        signal.throwIfAborted();
        return { exitCode, timedOut: false, evidence: { engineVersion, signatureVersion, signatureBundleSha256, sourceSha256, byteLength: bytes,
          ...(readonlyRuntime ? { runtimeManifestSha256: readonlyRuntime.manifestSha256, executableSha256: config.executableSha256,
            dailyTimestampSeconds: readonlyRuntime.manifest.cvds["daily.cvd"].timestampSeconds, scannerPolicyVersion: readonlyRuntime.manifest.scannerPolicyVersion } : {}) } };
      } catch { return failure(timedOut || outerSignal.aborted, phase); }
      finally {
        clearTimeout(timer);
        outerSignal.removeEventListener('abort', abort);
        if (scratch) {
          try {
            if (executableDirectory) await chmod(executableDirectory, 0o700);
            await rm(scratch, { recursive: true, force: true });
          }
          catch { return failure(timedOut || outerSignal.aborted, 'cleanup_failed'); }
        }
      }
    },
  };
}
