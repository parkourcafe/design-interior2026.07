import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, open, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import type { R1ClamAvInvocation, R1ClamAvRunner } from "./clamav-adapter";

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
  };
}

const maxOutputBytes = 65_536;
const chunkBytes = 65_536;
const maxSignatureAgeSeconds = 86_400;
const failure = (timedOut = false, reason = "scan_incomplete"): ClamAvProcessResult => ({ exitCode: null, timedOut, reason });

async function digestFile(path: string, signal: AbortSignal): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

/** Local process adapter. Production must additionally supply the OS sandbox
 * required by MASTER 5.3 (network denial and CPU/RAM/read-only runtime limits).
 * This implementation is exercised only on synthetic files until that gate. */
export function createClamAvProcessRunner(config: ClamAvProcessConfig): R1ClamAvRunner & {
  run(input: R1ClamAvInvocation, signal: AbortSignal): Promise<ClamAvProcessResult>;
} {
  return {
    async run(input, outerSignal): Promise<ClamAvProcessResult> {
      if (![config.executable, config.databaseDirectory, config.scratchDirectory].every(isAbsolute)
        || !/^[a-f0-9]{64}$/.test(config.executableSha256)
        || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 300_000
        || !Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > 100_000_000
        || !/^[a-f0-9]{64}$/.test(input.checksumHex) || process.platform === 'win32') return failure();

      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      outerSignal.addEventListener('abort', abort, { once: true });
      if (outerSignal.aborted) abort();
      const timer = setTimeout(() => { timedOut = true; abort(); }, input.timeoutMs);
      let scratch: string | undefined;
      let phase = "verify_executable";
      try {
        const { signal } = controller;
        signal.throwIfAborted();
        if (await digestFile(config.executable, signal) !== config.executableSha256) return failure(false, phase);
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
        phase = "create_scratch";
        scratch = await mkdtemp(join(config.scratchDirectory, 'r1-av-'));
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
        phase = "execute_scanner";
        const child = spawn(config.executable, args, {
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
        if (!engineVersion) return failure(false, phase);
        signal.throwIfAborted();
        return { exitCode, timedOut: false, evidence: { engineVersion, signatureVersion, signatureBundleSha256, sourceSha256, byteLength: bytes } };
      } catch { return failure(timedOut || outerSignal.aborted, phase); }
      finally {
        clearTimeout(timer);
        outerSignal.removeEventListener('abort', abort);
        if (scratch) {
          try { await rm(scratch, { recursive: true, force: true }); }
          catch { return failure(timedOut || outerSignal.aborted, 'cleanup_failed'); }
        }
      }
    },
  };
}
