import { createHash } from 'node:crypto';
import { existsSync, lstatSync, renameSync } from 'node:fs';
import { chmod, mkdtemp, open, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as fsPromises from 'node:fs/promises';
import * as childProcess from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClamAvProcessRunner } from './clamav-process';
import { scanWithR1ClamAv } from './clamav-adapter';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, rm: vi.fn(original.rm) };
});
vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  return { ...original, spawn: vi.fn(original.spawn) };
});

const roots: string[] = [];
const handles: Awaited<ReturnType<typeof open>>[] = [];
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const summary = 'stdin: OK\nKnown viruses: 1\nEngine version: 1.5.4\nScanned files: 1\nInfected files: 0\n';

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(handles.splice(0).map(handle => handle.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(script: string, ageSeconds = 0, acknowledgeSlowStartup = false) {
  const root = await mkdtemp(join(tmpdir(), 'r1-av-process-test-'));
  roots.push(root);
  // Synthetic signature headers only for the subprocess protocol tests. The
  // actual scanner integration uses signed official databases separately.
  const header = `ClamAV-VDB:synthetic:1:1:90:hash:signature:fixture:${Math.floor(Date.now()/1000) - ageSeconds}`;
  for (const name of ['main.cvd', 'daily.cvd', 'bytecode.cvd']) await writeFile(join(root, name), header.padEnd(512));
  const executable = join(root, 'synthetic-engine');
  const body = acknowledgeSlowStartup
    ? `setTimeout(() => { require('node:fs').writeFileSync('../started', String(process.pid)); ${script} }, 2100);`
    : script;
  await writeFile(executable, `#!${process.execPath}\n${body}\n`);
  await chmod(executable, 0o700);
  const bytes = Buffer.from('local synthetic scanner fixture');
  await writeFile(join(root, 'input'), bytes);
  const file = await open(join(root, 'input'), 'r');
  handles.push(file);
  const config = { executable, executableSha256: sha(await readFile(executable)), databaseDirectory: root, scratchDirectory: root };
  const input = { file, byteLength: bytes.length, checksumHex: sha(bytes), timeoutMs: 2000 };
  return { root, config, input, runner: createClamAvProcessRunner(config) };
}

// Success assertions must not spend their scanner budget on macOS's variable
// first execution of a new shebang inode. Only parent timers are controlled;
// the child deliberately acknowledges after 2100 real ms (> the 2000ms budget).
async function withAcknowledgedStartup<T>(root: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const wallSetTimeout = globalThis.setTimeout;
  const wallClearTimeout = globalThis.clearTimeout;
  const controller = new AbortController();
  const spawnStart = vi.mocked(childProcess.spawn).mock.results.length;
  const children = (): childProcess.ChildProcess[] => vi.mocked(childProcess.spawn).mock.results
    .slice(spawnStart).flatMap(result => result.type === 'return' ? [result.value] : []);
  const killChildren = () => {
    for (const child of children()) {
      if (child.pid && child.exitCode === null && child.signalCode === null) {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }
  };
  let wallTimer: ReturnType<typeof setTimeout> | undefined;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const running = Promise.resolve().then(() => run(controller.signal));
  const verified = running.then(async result => {
    const acknowledgedPid = Number(await readFile(join(root, 'started'), 'utf8'));
    expect(children()).toHaveLength(1);
    expect(acknowledgedPid).toBe(children()[0]!.pid);
    expect(children()[0]!.exitCode).toBe(0);
    expect(children()[0]!.signalCode).toBeNull();
    try { process.kill(acknowledgedPid, 0); throw new Error('synthetic_scanner_still_alive'); }
    catch (error) { expect(error).toMatchObject({ code: 'ESRCH' }); }
    expect(vi.getTimerCount()).toBe(0);
    return result;
  });
  try {
    return await Promise.race([verified, new Promise<never>((_resolve, reject) => {
      wallTimer = wallSetTimeout(() => {
        controller.abort(); killChildren(); reject(new Error('synthetic_scanner_wall_timeout'));
      }, 8000);
    })]);
  } finally {
    controller.abort(); killChildren();
    try {
      await Promise.race([running.then(() => {}, () => {}), new Promise<never>((_resolve, reject) => {
        cleanupTimer = wallSetTimeout(() => reject(new Error('synthetic_scanner_cleanup_timeout')), 2000);
      })]);
      for (const child of children()) {
        expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      }
    } finally {
      wallClearTimeout(wallTimer); wallClearTimeout(cleanupTimer); vi.useRealTimers();
    }
  }
}

describe('local ClamAV process boundary', () => {
  it('streams a pinned descriptor from offset zero and strips parent environment and raw output', async () => {
    const { root, input, runner } = await fixture(`
      if (process.env.R1_FORBIDDEN_TEST_ENV) process.exit(2);
      process.stdin.resume();
      process.stdin.on('end', () => process.stdout.write(${JSON.stringify(summary)}));
    `, 0, true);
    // Advance the borrowed descriptor; the runner must still scan every byte.
    await input.file.read(Buffer.alloc(4), 0, 4, null);
    process.env.R1_FORBIDDEN_TEST_ENV = 'synthetic';
    try {
      const result = await withAcknowledgedStartup(root, signal => runner.run(input, signal));
      expect(result).toMatchObject({ exitCode: 0, timedOut: false, evidence: { sourceSha256: input.checksumHex, byteLength: input.byteLength } });
      expect(result).not.toHaveProperty('output');
      expect(result).not.toHaveProperty('filePath');
      expect(input.file.fd).toBeGreaterThan(2);
    } finally { delete process.env.R1_FORBIDDEN_TEST_ENV; }
  }, 12_000);

  it.each([
    ['silent success', 'process.stdin.resume();'],
    ['scanner diagnostic', `process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify('ERROR: sensitive diagnostic\n' + summary)}));`],
    ['unknown exit', 'process.stdin.resume(); process.stdin.on("end", () => process.exit(2));'],
    ['output limit', 'process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("x".repeat(100000)));'],
  ])('fails closed for %s', async (_name, script) => {
    const { runner, input } = await fixture(script);
    expect(await scanWithR1ClamAv(runner, input)).toBe('scan_failed');
  });

  it('rejects substituted bytes and modified executable', async () => {
    const { runner, input, config } = await fixture(`process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(summary)}));`);
    expect(await scanWithR1ClamAv(runner, { ...input, checksumHex: '0'.repeat(64) })).toBe('scan_failed');
    await writeFile(config.executable, '#!/bin/false\n');
    expect(await scanWithR1ClamAv(runner, input)).toBe('scan_failed');
  });

  it.each(['atomic replacement', 'in-place write', 'package symlink update'])(
    'rejects executable %s after verification without running substituted bytes', async (change) => {
      const { root, input, config } = await fixture(`process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(summary)}));`);
      const marker = join(root, 'unverified-executable-ran');
      const replacement = join(root, 'replacement-engine');
      const malicious = `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(summary)}));\n`;
      await writeFile(replacement, malicious, { mode: 0o700 });
      const executable = change === 'package symlink update' ? join(root, 'package-engine') : config.executable;
      if (change === 'package symlink update') await symlink(config.executable, executable);
      const runner = createClamAvProcessRunner({ ...config, executable });
      const original = input.file.stat.bind(input.file);
      vi.spyOn(input.file, 'stat').mockImplementationOnce(async () => {
        if (change === 'in-place write') await writeFile(executable, malicious);
        else if (change === 'package symlink update') {
          const newLink = join(root, 'updated-package-link');
          await symlink(replacement, newLink);
          await rename(newLink, executable);
        } else await rename(replacement, executable);
        return original({ bigint: true });
      });
      expect(await scanWithR1ClamAv(runner, input)).toBe('scan_failed');
      expect(existsSync(marker)).toBe(false);
    },
  );

  it('executes the sealed private snapshot when the package path changes at spawn', async () => {
    const { root, runner, input, config } = await fixture(`process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(summary)}));`);
    const marker = join(root, 'unverified-executable-ran');
    const replacement = join(root, 'replacement-engine');
    await writeFile(replacement, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(summary)}));\n`, { mode: 0o700 });
    const original = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    let launchedPath = '';
    vi.mocked(childProcess.spawn).mockImplementationOnce((...args: Parameters<typeof childProcess.spawn>) => {
      launchedPath = args[0];
      renameSync(replacement, config.executable);
      return original.spawn(...args);
    });
    expect(await scanWithR1ClamAv(runner, input)).toBe('scan_failed');
    expect(existsSync(marker)).toBe(false);
    expect(launchedPath).not.toBe(config.executable);
    expect(existsSync(launchedPath)).toBe(false);
  });

  it('uses a read-only, separately owned inode in a private executable directory', async () => {
    const { root, runner, input, config } = await fixture(`process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(summary)}));`, 0, true);
    const original = await vi.importActual<typeof import('node:child_process')>('node:child_process');
    vi.mocked(childProcess.spawn).mockImplementationOnce((...args: Parameters<typeof childProcess.spawn>) => {
      const stat = lstatSync(args[0]);
      expect(stat.isFile()).toBe(true);
      expect(stat.nlink).toBe(1);
      expect(stat.ino).not.toBe(lstatSync(config.executable).ino);
      expect(stat.mode & 0o777).toBe(0o500);
      expect(lstatSync(dirname(args[0])).mode & 0o777).toBe(0o500);
      return original.spawn(...args);
    });
    expect(await withAcknowledgedStartup(root, signal => scanWithR1ClamAv({
      run: (invocation, innerSignal) => runner.run(invocation, AbortSignal.any([signal, innerSignal])),
    }, input))).toBe('clean');
  }, 12_000);

  it('rejects expired or missing signatures', async () => {
    const { runner, input, config } = await fixture('process.exit(0);', 86_401);
    expect(await scanWithR1ClamAv(runner, input)).toBe('scan_failed');
    await rm(join(config.databaseDirectory, 'daily.cvd'));
    expect(await scanWithR1ClamAv(runner, input)).toBe('scan_failed');
  });

  it('terminates the process on deadline and waits for its exit', async () => {
    const { root, runner, input } = await fixture(`
      // Deliberately acknowledge startup after the parent's 500ms budget.
      setTimeout(() => require('node:fs').writeFileSync('../pid', String(process.pid)), 600);
      process.stdin.resume(); setInterval(() => {}, 1000);
    `);
    const realSetTimeout = globalThis.setTimeout;
    const controller = new AbortController();
    // Control only the parent's deadline. The real child must have started
    // before we test termination; busy runners can take >500ms to spawn it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const running = runner.run({ ...input, timeoutMs: 500 }, controller.signal);
    try {
      const startupDeadline = Date.now() + 5000;
      while (!existsSync(join(root, 'pid'))) {
        if (Date.now() >= startupDeadline) throw new Error('synthetic_scanner_startup_timeout');
        await new Promise<void>(resolve => realSetTimeout(resolve, 10));
      }
      const pid = Number(await readFile(join(root, 'pid'), 'utf8'));
      expect(() => process.kill(pid, 0)).not.toThrow();
      await vi.advanceTimersByTimeAsync(499);
      expect(() => process.kill(pid, 0)).not.toThrow();
      await vi.advanceTimersByTimeAsync(1);
      expect(await running).toMatchObject({ exitCode: null, timedOut: true });
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      controller.abort();
      vi.useRealTimers();
      await running;
    }
  }, 10_000);

  it('does not return success when cancellation arrives during final file verification', async () => {
    const { runner, input } = await fixture(`process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(summary)}));`);
    const controller = new AbortController();
    const original = input.file.stat.bind(input.file);
    let calls = 0;
    vi.spyOn(input.file, 'stat').mockImplementation(() => {
      if (++calls === 2) controller.abort();
      return original({ bigint: true });
    });
    expect(await runner.run(input, controller.signal)).toMatchObject({ exitCode: null, timedOut: true });
  });

  it('sanitizes cleanup errors instead of exposing a filesystem path', async () => {
    const { runner, input } = await fixture(`process.stdin.resume(); process.stdin.on('end', () => console.log(${JSON.stringify(summary)}));`);
    vi.mocked(fsPromises.rm).mockRejectedValueOnce(new Error('/private/sensitive/path'));
    expect(await runner.run(input, new AbortController().signal)).toEqual({ exitCode: null, timedOut: false, reason: 'cleanup_failed' });
  });
});
