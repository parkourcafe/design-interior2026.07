import { createHash } from 'node:crypto';
import { chmod, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as fsPromises from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createClamAvProcessRunner } from './clamav-process';
import { scanWithR1ClamAv } from './clamav-adapter';

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs/promises')>();
  return { ...original, rm: vi.fn(original.rm) };
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

async function fixture(script: string, ageSeconds = 0) {
  const root = await mkdtemp(join(tmpdir(), 'r1-av-process-test-'));
  roots.push(root);
  // Synthetic signature headers only for the subprocess protocol tests. The
  // actual scanner integration uses signed official databases separately.
  const header = `ClamAV-VDB:synthetic:1:1:90:hash:signature:fixture:${Math.floor(Date.now()/1000) - ageSeconds}`;
  for (const name of ['main.cvd', 'daily.cvd', 'bytecode.cvd']) await writeFile(join(root, name), header.padEnd(512));
  const executable = join(root, 'synthetic-engine');
  await writeFile(executable, `#!${process.execPath}\n${script}\n`);
  await chmod(executable, 0o700);
  const bytes = Buffer.from('local synthetic scanner fixture');
  await writeFile(join(root, 'input'), bytes);
  const file = await open(join(root, 'input'), 'r');
  handles.push(file);
  const config = { executable, executableSha256: sha(await readFile(executable)), databaseDirectory: root, scratchDirectory: root };
  const input = { file, byteLength: bytes.length, checksumHex: sha(bytes), timeoutMs: 2000 };
  return { root, config, input, runner: createClamAvProcessRunner(config) };
}

describe('local ClamAV process boundary', () => {
  it('streams a pinned descriptor from offset zero and strips parent environment and raw output', async () => {
    const { input, runner } = await fixture(`
      if (process.env.R1_FORBIDDEN_TEST_ENV) process.exit(2);
      process.stdin.resume();
      process.stdin.on('end', () => process.stdout.write(${JSON.stringify(summary)}));
    `);
    // Advance the borrowed descriptor; the runner must still scan every byte.
    await input.file.read(Buffer.alloc(4), 0, 4, null);
    process.env.R1_FORBIDDEN_TEST_ENV = 'synthetic';
    try {
      const result = await runner.run(input, new AbortController().signal);
      expect(result).toMatchObject({ exitCode: 0, timedOut: false, evidence: { sourceSha256: input.checksumHex, byteLength: input.byteLength } });
      expect(result).not.toHaveProperty('output');
      expect(result).not.toHaveProperty('filePath');
      expect(input.file.fd).toBeGreaterThan(2);
    } finally { delete process.env.R1_FORBIDDEN_TEST_ENV; }
  });

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

  it('rejects expired or missing signatures', async () => {
    const { runner, input, config } = await fixture('process.exit(0);', 86_401);
    expect(await scanWithR1ClamAv(runner, input)).toBe('scan_failed');
    await rm(join(config.databaseDirectory, 'daily.cvd'));
    expect(await scanWithR1ClamAv(runner, input)).toBe('scan_failed');
  });

  it('terminates the process on deadline and waits for its exit', async () => {
    const { root, runner, input } = await fixture(`
      require('node:fs').writeFileSync('../pid', String(process.pid));
      process.stdin.resume(); setInterval(() => {}, 1000);
    `);
    const result = await runner.run({ ...input, timeoutMs: 500 }, new AbortController().signal);
    expect(result).toMatchObject({ exitCode: null, timedOut: true });
    const pid = Number(await readFile(join(root, 'pid'), 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });

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
