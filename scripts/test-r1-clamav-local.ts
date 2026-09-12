import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { createClamAvProcessRunner } from '../lib/integration-gateway/r1-worker/clamav-process';
import type { ClamAvProcessResult } from '../lib/integration-gateway/r1-worker/clamav-process';

// Explicit opt-in local synthetic acceptance. No hosted database, client corpus,
// signature download, background service, or production runtime is invoked.
async function main() {
  const [executable, databaseDirectory] = process.argv.slice(2);
  assert(executable && databaseDirectory, 'Supply installed clamscan and official signature directory');
  const scratchDirectory = await mkdtemp(join(tmpdir(), 'r1-clamav-acceptance-'));
  const sha = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const config = { executable, executableSha256: sha(await readFile(executable)), databaseDirectory, scratchDirectory };
  const runner = createClamAvProcessRunner(config);
  const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
  const cases: { name: string; bytes: Buffer; expected: number | null; timeoutMs?: number; wrongHash?: boolean; missingDatabase?: boolean }[] = [
    { name: 'clean', bytes: Buffer.from('R1 clean synthetic document'), expected: 0 },
    { name: 'eicar', bytes: eicar, expected: 1 },
    { name: 'compressed_eicar', bytes: gzipSync(eicar), expected: 1 },
    { name: 'digest_substitution', bytes: Buffer.from('Changed synthetic bytes'), expected: null, wrongHash: true },
    { name: 'deadline', bytes: Buffer.from('Synthetic timeout'), expected: null, timeoutMs: 1 },
    { name: 'missing_database', bytes: Buffer.from('Synthetic missing signatures'), expected: null, missingDatabase: true },
  ];
  const results: { name: string; result: ClamAvProcessResult }[] = [];
  try {
    for (const scenario of cases) {
      const path = join(scratchDirectory, scenario.name);
      await writeFile(path, scenario.bytes, { mode: 0o600 });
      const file = await open(path, 'r');
      try {
        const selected = scenario.missingDatabase ? createClamAvProcessRunner({ ...config, databaseDirectory: join(scratchDirectory, 'absent') }) : runner;
        const result = await selected.run({ file, byteLength: scenario.bytes.length, checksumHex: scenario.wrongHash ? '0'.repeat(64) : sha(scenario.bytes), timeoutMs: scenario.timeoutMs ?? 30_000 }, new AbortController().signal);
        console.log(JSON.stringify({ case: scenario.name, passed: result.exitCode === scenario.expected, ...result }));
        assert.equal(result.exitCode, scenario.expected, `Unexpected outcome for ${scenario.name}`);
        results.push({ name: scenario.name, result });

      } finally { await file.close(); }
    }
    console.log(JSON.stringify({ status: 'R1_CLAMAV_LOCAL_SYNTHETIC_PASS', cases: results.length, executableSha256: config.executableSha256, osSandboxVerified: false, gate0Passed: false }));
  } finally { await rm(scratchDirectory, { recursive: true, force: true }); }
}

main().catch(() => { console.error('R1_CLAMAV_LOCAL_SYNTHETIC_FAILED'); process.exitCode = 1; });
