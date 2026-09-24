import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { readFile, writeFile, open, realpath, lstat, mkdtemp } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';
import { homedir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DockerClient } from '../../../lib/integration-gateway/r1-sandbox/docker';
import { AV_PROFILE } from '../../../lib/integration-gateway/r1-sandbox/profile';
import { observeLocalHost, assertHostAdmission } from '../../../lib/integration-gateway/r1-sandbox/admission';
import { assertReadonlyImageOs } from '../../../lib/integration-gateway/r1-worker/clamav-runtime-manifest';

const root = '/private/tmp/remhaos-clamav-linux17.rBDwPn';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const workspace = resolve(repo, '..');
const endpoint = `unix://${join(homedir(),'.colima/archidom-ap1-disposable/docker.sock')}`;
const imageId = 'sha256:0e6f64a14da7f5d8de1a6565e1516f6d023817613bbcdb729b7811c6d984b750';
const docker = new DockerClient({ executable: '/opt/homebrew/bin/docker', endpoint });
const require = createRequire(`${repo}/package.json`);
const { zipSync, strToU8 } = require('fflate');
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const scopeRoots = new Set<string>();
let output = '', cancelled = false;
const report: Record<string, any> = { schema: 'wp32-local17-linux/1', status: 'running',
  startedAt: new Date().toISOString(), profileId: 'wp32-clamav-local17/v1', limits: AV_PROFILE,
  maxRecursion: 17, imageId, architecture: 'linux/amd64', existingR1PolicyChanged: false,
  productionChanged: false, r1LeaseOrMaterializationProof: false, controls: [], sources: [] };
function assert(ok: unknown, code: string): asserts ok { if (!ok) throw new Error(code); }
function safeError(error: any) { return /^[A-Za-z0-9_:-]{1,100}$/.test(error?.message ?? '') ? error.message : 'LOCAL17_UNEXPECTED_ERROR'; }
async function save() { if (output) await writeFile(`${output}/evidence.json`, JSON.stringify(report, null, 2), { mode: 0o600 }); }
process.on('SIGTERM', () => { cancelled = true; });
process.on('SIGINT', () => { cancelled = true; });

function args(name: string, nonce: string, mode: string) {
  return ['create', '--pull=never', '--platform=linux/amd64', '--name', name,
    '--label', `wp32.local17.nonce=${nonce}`, '--restart=no', '--no-healthcheck', '--log-driver=none', '--init', '--interactive',
    '--user=65532:65532', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--cgroupns=private', '--ipc=private',
    '--network=none', '--read-only', '--cpus=1', `--memory=${AV_PROFILE.memoryBytes}`, `--memory-swap=${AV_PROFILE.memoryBytes}`,
    `--pids-limit=${AV_PROFILE.pids}`, `--shm-size=${AV_PROFILE.shmBytes}`, '--ulimit=nofile=256:256', '--ulimit=core=0:0',
    `--tmpfs=/scratch:rw,nosuid,nodev,noexec,size=${AV_PROFILE.scratchBytes},mode=0700,uid=65532,gid=65532`,
    '--workdir=/scratch', '--entrypoint=/bin/sh', imageId, '/opt/wp32/local-scan.sh', mode];
}
function owned(c: any, name: string, nonce: string, mode: string) {
  assert(c && c.Image === imageId && c.Name === `/${name}` && c.Labels['wp32.local17.nonce'] === nonce, 'CONTAINER_OWNERSHIP_MISMATCH');
  const h = c.HostConfig;
  assert(c.User === '65532:65532' && JSON.stringify(c.Entrypoint) === '["/bin/sh"]'
    && JSON.stringify(c.Cmd) === JSON.stringify(['/opt/wp32/local-scan.sh', mode]), 'CONTAINER_COMMAND_MISMATCH');
  assert(h.ReadonlyRootfs && h.NetworkMode === 'none' && !h.Privileged && h.Init
    && JSON.stringify(h.CapDrop) === '["ALL"]' && !h.CapAdd?.length
    && h.SecurityOpt.includes('no-new-privileges') && !h.SecurityOpt.some((v: string) => v.includes('unconfined'))
    && h.Memory === AV_PROFILE.memoryBytes && h.MemorySwap === AV_PROFILE.memoryBytes && h.NanoCpus === 1000000000
    && h.PidsLimit === AV_PROFILE.pids && h.ShmSize === AV_PROFILE.shmBytes
    && h.Tmpfs?.['/scratch'] === `rw,nosuid,nodev,noexec,size=${AV_PROFILE.scratchBytes},mode=0700,uid=65532,gid=65532`
    && Object.keys(h.Tmpfs).length === 1 && !h.Binds?.length && !h.Mounts?.length && !h.Devices?.length
    && c.Mounts.every((m: any) => m.Type === 'tmpfs') && h.PidMode === '' && h.IpcMode === 'private'
    && h.CgroupnsMode === 'private' && h.LogConfig.Type === 'none' && h.RestartPolicy.Name === 'no'
    && !Object.keys(h.PortBindings ?? {}).length, 'CONTAINER_LIMITS_MISMATCH');
}
async function attach(id: string, bytes: Buffer, budget: number) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string; failed: boolean }>(resolve => {
    const child = spawn('/opt/homebrew/bin/docker', ['--config', `${root}/docker`, '--host', endpoint, 'start', '--attach', '--interactive', id],
      { env: { PATH: '/opt/homebrew/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', NODE_ENV: 'test' }, stdio: 'pipe' });
    let stdout = '', stderr = '', size = 0, failed = false;
    const abort = () => { failed = true; child.kill('SIGKILL'); };
    const timer = setTimeout(abort, budget);
    const cancellation = setInterval(() => { if (cancelled) abort(); }, 100);
    const collect = (data: Buffer, err: boolean) => {
      size += data.length; if (size > AV_PROFILE.outputBytes) { abort(); return; }
      if (err) stderr += data.toString(); else stdout += data.toString();
    };
    child.stdout.on('data', data => collect(data, false)); child.stderr.on('data', data => collect(data, true));
    child.on('error', abort); child.stdin.on('error', () => { failed = true; });
    child.on('close', code => { clearTimeout(timer); clearInterval(cancellation); resolve({ code, stdout, stderr, failed }); });
    child.stdin.end(bytes);
  });
}
async function job(mode: 'probe' | 'scan' | 'timeout-control', bytes = Buffer.alloc(0), boundNonce?: string) {
  assert(!cancelled, 'CANCELLED');
  for (let attempt = 0; ; attempt++) {
    try {
      const observation = await observeLocalHost(docker, '/opt/homebrew/bin/colima', 'archidom-ap1-disposable');
      assertHostAdmission(observation, Date.now(), undefined, AV_PROFILE.id);
      break;
    } catch (error) {
      // Resample only; never create a container using a stale observation.
      if (safeError(error) !== 'sandbox_metrics_stale' || attempt >= 2 || cancelled) throw error;
      report.metricsResamples = (report.metricsResamples ?? 0) + 1;
    }
  }
  const started = performance.now();
  const remaining = () => { const ms = Math.floor(AV_PROFILE.wallMs - (performance.now() - started)); assert(ms > 0 && !cancelled, 'JOB_DEADLINE'); return ms; };
  const nonce = boundNonce ?? randomUUID(), name = `wp32-local17-${nonce}`;
  let id: string | undefined;
  let clean = false;
  report.activeJob = { name, nonce, mode, startedAt: new Date().toISOString() }; await save();
  try {
    const created = await docker.command(args(name, nonce, mode), Math.min(10000, remaining()));
    assert(created.code === 0 && /^[a-f0-9]{64}$/.test(created.stdout.trim()), 'CONTAINER_CREATE_FAILED');
    id = created.stdout.trim(); report.activeJob.id = id; await save();
    owned(await docker.inspect(id), name, nonce, mode);
    const result = await attach(id, bytes, remaining());
    const state = await docker.inspect(id); owned(state, name, nonce, mode);
    assert(!state!.Running && !state!.OOMKilled && state!.ExitCode === result.code && !result.failed, 'SCAN_PROCESS_INCOMPLETE');
    if (mode === 'probe') return { stdout: result.stdout, code: result.code };
    if (mode === 'timeout-control') return { code: result.code, milliseconds: performance.now() - started };
    const binding = result.stdout.match(/^WP32_INPUT ([a-f0-9]{64}) ([0-9]+)$/m);
    const text = `${result.stdout}\n${result.stderr}`;
    const names = [...text.matchAll(/: ([A-Za-z0-9][A-Za-z0-9._-]{0,160}) FOUND$/gm)].map(m => m[1]);
    assert(binding?.[1] === sha(bytes) && Number(binding?.[2]) === bytes.length, 'SCANNED_BYTES_MISMATCH');
    assert(!/\b(?:ERROR|WARNING)\b/i.test(text) && /^Known viruses: [1-9]\d*$/m.test(text)
      && /^Scanned files: [1-9]\d*$/m.test(text) && /^Engine version: 1\.5\.4$/m.test(text), 'SCAN_SUMMARY_INCOMPLETE');
    const isClean = result.code === 0 && /^\/scratch\/input: OK$/m.test(text) && /^Infected files: 0$/m.test(text);
    const alert = result.code === 1 && names.length > 0 && /^Infected files: [1-9]\d*$/m.test(text);
    assert(isClean || alert, 'SCAN_VERDICT_INCOMPLETE');
    return { sourceSha256: sha(bytes), containerSha256: binding![1], byteLength: bytes.length,
      status: isClean ? 'clean' : 'detection_or_policy_alert', nativeExitCode: result.code, detectionNames: names,
      milliseconds: performance.now() - started,
      sandboxEvidence: { inspected: state, limits: AV_PROFILE, imageId, nonce } };
  } finally {
    if (!id) {
      const lookup = await docker.command(['ps','-aq','--no-trunc','--filter',`name=^/${name}$`]);
      if (lookup.code === 0 && /^[a-f0-9]{64}$/.test(lookup.stdout.trim())) id = lookup.stdout.trim();
    }
    if (id) {
      const current = await docker.inspect(id);
      if (current) {
        owned(current, name, nonce, mode);
        const removed = await docker.command(['rm','--force',id], 10000);
        assert(removed.code === 0 && await docker.inspect(id) === null, 'CONTAINER_CLEANUP_UNCONFIRMED');
      }
      clean = true;
    }
    report.lastJob = { ...report.activeJob, cleanupConfirmed: clean }; delete report.activeJob; await save();
    assert(clean, 'CONTAINER_CLEANUP_UNCONFIRMED');
  }
}
function pdf() {
  const content = 'BT /F1 12 Tf 20 80 Td (Benign local AV control) Tj ET';
  const objects = [ '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' ];
  let text = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(text)); text += `${i+1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}
function xlsx() {
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Control" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Benign local AV control</t></is></c></row></sheetData></worksheet>'),
  }));
}
async function main(controlsOnly = false, skipControls = false) {
  output = await mkdtemp(`${root}/evidence-`); console.log(`LOCAL17_OUTPUT=${output}`);
  report.harnessSha256 = sha(await readFile(new URL(import.meta.url)));
  report.receiverSha256 = sha(await readFile(`${root}/build/local-scan.sh`));
  const inventoryRaw = await readFile(`${workspace}/artifacts/ARCHITECT_LOCAL_SOURCE_INVENTORY_20260923.json`);
  report.inventorySha256 = sha(inventoryRaw);
  assert(report.inventorySha256 === 'e918afd7a757756b5c54421c5035704401abef7aab5637036517e8a7720157f6', 'INVENTORY_CHANGED');
  const inventory = JSON.parse(inventoryRaw.toString()); assert(inventory.rows.length === 32, 'INVENTORY_COUNT_CHANGED');
  for (const entry of inventory.rows) {
    assert(typeof entry.root==='string'&&entry.root.startsWith('/'),'SOURCE_ROOT_INVALID');scopeRoots.add(entry.root);
  }
  assert(scopeRoots.size===3,'SOURCE_ROOT_SET_CHANGED');
  if (process.argv.includes('--resume')) {
    const priorBytes = await readFile(`${workspace}/backups/ARCHITECT_CLAMAV_LOCAL17_PARTIAL_20260923.json`);
    const priorDigest = sha(priorBytes);
    assert(priorDigest === '2f481dbf82b52963ed8254c3e1dcda6348e8502a5bc578f4847e7171f6f7e804', 'PRIOR_EVIDENCE_CHANGED');
    const prior = JSON.parse(priorBytes.toString());
    assert(prior.status === 'LOCAL17_INCOMPLETE' && prior.code === 'sandbox_metrics_stale' && prior.imageId === imageId
      && prior.inventorySha256 === report.inventorySha256 && prior.receiverSha256 === report.receiverSha256
      && prior.lastJob?.cleanupConfirmed === true && !prior.activeJob && prior.sources.length === 13
      && prior.sources.every((r:any,i:number)=>r.sourceIndex===i+1 && r.status==='clean' && r.originalUnchanged===true
        && r.sourceSha256===inventory.rows[i].sha256 && r.containerSha256===r.sourceSha256), 'PRIOR_EVIDENCE_SCOPE_INVALID');
    report.resumedFromSha256 = priorDigest;
    report.sources = prior.sources.map((r:any)=>({...r,originEvidenceSha256:priorDigest}));
  }
  const image = await docker.command(['image','inspect','--format','{{json .}}',imageId]);
  assert(image.code === 0, 'IMAGE_MISSING'); const metadata = JSON.parse(image.stdout);
  assert(metadata.Id === imageId && metadata.Os === 'linux' && metadata.Architecture === 'amd64' && !metadata.Config.Volumes, 'IMAGE_MISMATCH');
  const cvds: Record<string,string> = {};
  for (const name of ['main','daily','bytecode']) cvds[name] = sha(await readFile(`${root}/build/${name}.cvd`));
  report.signatureBundleSha256 = sha(['main','daily','bytecode'].map(n => cvds[n]).join(''));
  assert(report.signatureBundleSha256 === '2cf0535e59f32757ebcaa39c281721b92986706b424158d31513a865d6071c79', 'CVD_CHANGED');
  const daily = (await readFile(`${root}/build/daily.cvd`)).subarray(0,512).toString('ascii').trim().split(':');
  const timestamp = Number(daily[8]); report.dailyTimestampSeconds = timestamp;
  report.dailyVersion = Number(daily[2]);
  assert(Number.isSafeInteger(report.dailyVersion) && report.dailyVersion > 0, 'CVD_VERSION_INVALID');
  assert(Date.now()/1000-timestamp >= -300 && Date.now()/1000-timestamp+360 <= 86400, 'CVD_STALE'); await save();
  const probe = await job('probe');
  assert(probe.code === 0 && probe.stdout, 'PROFILE_PROBE_FAILED'); const p = probe.stdout;
  for (const line of ['WP32_UID=65532','WP32_GID=65532','WP32_MEMORY=3221225472','WP32_SWAP=0','WP32_PIDS=64',
    'WP32_CPU=100000 100000','WP32_SCRATCH_KIB=786432','WP32_ROOT_WRITE_DENIED']) assert(p.split('\n').includes(line), 'KERNEL_LIMIT_PROBE_FAILED');
  assert(/^WP32_INTERFACES=lo\s*$/m.test(p) && /^CapEff:\s+0+$/m.test(p) && /^NoNewPrivs:\s+1$/m.test(p) && /^Seccomp:\s+2$/m.test(p), 'KERNEL_ISOLATION_PROBE_FAILED');
  const mountinfo = p.match(/WP32_MOUNTINFO_BEGIN\n([\s\S]*?)WP32_MOUNTINFO_END/)?.[1];
  const network = p.match(/WP32_NETDEV_BEGIN\n([\s\S]*?)WP32_NETDEV_END/)?.[1];
  assert(mountinfo && network, 'KERNEL_MOUNT_NETWORK_PROOF_MISSING');
  assertReadonlyImageOs({ platform:'linux',uid:Number(p.match(/^WP32_UID=(\d+)$/m)?.[1]),
    gid:Number(p.match(/^WP32_GID=(\d+)$/m)?.[1]),status:p,mountinfo,network },
    ['/usr/bin/clamscan','/opt/wp32/local-scan.sh',...['main','daily','bytecode'].map(n=>`/opt/wp32/cvd/${n}.cvd`)]);
  assert(p.includes(`${report.receiverSha256}  /opt/wp32/local-scan.sh`), 'IMAGE_RECEIVER_MISMATCH');
  report.scannerExecutableSha256 = p.match(/^([a-f0-9]{64})  \/usr\/bin\/clamscan$/m)?.[1];
  assert(report.scannerExecutableSha256, 'ENGINE_HASH_MISSING');
  for (const [name, digest] of Object.entries(cvds)) assert(p.includes(`${digest}  /opt/wp32/cvd/${name}.cvd`), 'IMAGE_CVD_MISMATCH');
  report.kernelProfileVerified = true; console.log('LOCAL17_KERNEL_PROFILE_VERIFIED');
  if (skipControls) { report.status='diagnostic_controls_skipped';report.finishedAt=new Date().toISOString();await save();return; }
  const deadline = await job('timeout-control'); assert(deadline.code === 137 && deadline.milliseconds! < 15000, 'INTERNAL_TIMEOUT_CONTROL_FAILED');
  report.controls.push({ name: 'internal_deadline', passed: true, ...deadline });
  const eicar = Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
  let nested = Buffer.from('Benign nested archive'); for (let i=0;i<24;i++) nested = gzipSync(nested);
  const fixtures = [ { name: 'benign_pdf', bytes: pdf(), expected: 'clean' }, { name: 'benign_xlsx', bytes: xlsx(), expected: 'clean' },
    { name: 'eicar', bytes: eicar, expected: 'eicar' }, { name: 'compressed_eicar', bytes: gzipSync(eicar), expected: 'eicar' },
    { name: 'over_depth', bytes: nested, expected: 'limit' } ];
  for (const fixture of fixtures) {
    const result = await job('scan',fixture.bytes);
    const passed = fixture.expected === 'clean' ? result.status === 'clean' : fixture.expected === 'eicar'
      ? (result.detectionNames??[]).some(n => typeof n==='string'&&/eicar/i.test(n))
      : (result.detectionNames??[]).includes('Heuristics.Limits.Exceeded.MaxRecursion');
    report.controls.push({ name: fixture.name, passed, ...result }); await save();
    console.log(JSON.stringify({ control: fixture.name, passed })); assert(passed, 'SCANNER_CONTROL_FAILED');
  }
  if (controlsOnly || process.argv.includes('--controls-only')) { report.status = 'controls_passed'; report.finishedAt = new Date().toISOString(); await save(); return; }
  for (const [index, entry] of inventory.rows.entries()) {
    assert(Date.now()/1000-timestamp+360 <= 86400, 'CVD_STALE');
    assert(scopeRoots.has(entry.root) && typeof entry.path === 'string' && !entry.path.startsWith('/')
      && !entry.path.split('/').some((s:string) => s==='..'||s==='.'), 'SOURCE_SCOPE_INVALID');
    const canonicalRoot = await realpath(entry.root), path = await realpath(`${entry.root}/${entry.path}`);
    assert(path.startsWith(`${canonicalRoot}/`), 'SOURCE_OUTSIDE_ROOT');
    const file = await open(path, constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const before = await file.stat({bigint:true}), named = await lstat(path,{bigint:true});
      assert(before.isFile() && before.nlink===1n && before.dev===named.dev && before.ino===named.ino
        && Number.isSafeInteger(entry.bytes) && entry.bytes>0 && entry.bytes<=100000000 && before.size===BigInt(entry.bytes), 'SOURCE_CHANGED');
      const bytes = await file.readFile(); assert(sha(bytes)===entry.sha256, 'SOURCE_HASH_CHANGED');
      if (report.resumedFromSha256 && index < 13) continue;
      const result = await job('scan',bytes);
      const after = await lstat(path,{bigint:true});
      const unchanged = before.ino===after.ino && before.dev===after.dev && before.size===after.size
        && before.mtimeNs===after.mtimeNs && before.ctimeNs===after.ctimeNs && await realpath(`${entry.root}/${entry.path}`)===path;
      report.sources.push({ sourceIndex:index+1, ...result, originalUnchanged:unchanged }); await save();
      console.log(JSON.stringify({ sourceIndex:index+1,status:result.status,originalUnchanged:unchanged })); assert(unchanged,'SOURCE_CHANGED_DURING_SCAN');
    } finally { await file.close(); }
  }
  report.status = report.sources.every((s:any)=>s.status==='clean') ? 'LOCAL17_CORPUS_CLEAN' : 'LOCAL17_CORPUS_ALERTS';
  report.summary = { scanned:report.sources.length,clean:report.sources.filter((s:any)=>s.status==='clean').length };
  report.finishedAt=new Date().toISOString(); await save(); console.log(JSON.stringify({ status:report.status,...report.summary }));
  if(report.status!=='LOCAL17_CORPUS_CLEAN') process.exitCode=2;
}
let initialized = false;
export async function initializeBoundScanner(options: {readonly diagnosticSkipControls?:boolean} = {}) {
  assert(!initialized, 'SCANNER_ALREADY_INITIALIZED');
  await main(true,options.diagnosticSkipControls===true); initialized = true;
  return { policyVersion: 'wp32-clamav-local17/v1', imageId, engineVersion: '1.5.4',
    executableSha256: report.scannerExecutableSha256, receiverSha256: report.receiverSha256,
    signatureBundleSha256: report.signatureBundleSha256, signatureVersion: report.dailyVersion,
    signatureTimestamp: report.dailyTimestampSeconds };
}
export async function scanClaimedBytes({ claim, bytes }: { claim: any; bytes: Uint8Array }) {
  assert(initialized && /^[a-f0-9-]{36}$/.test(claim.nonce), 'SCANNER_NOT_INITIALIZED');
  const expected = { policyVersion: 'wp32-clamav-local17/v1', imageId, engineVersion: '1.5.4',
    executableSha256: report.scannerExecutableSha256, receiverSha256: report.receiverSha256,
    signatureBundleSha256: report.signatureBundleSha256, signatureVersion: report.dailyVersion,
    signatureTimestamp: report.dailyTimestampSeconds };
  assert(Object.keys(expected).length === Object.keys(claim.policy).length &&
    Object.entries(expected).every(([key,value])=>claim.policy[key]===value), 'CLAIM_POLICY_MISMATCH');
  // The local VM can run a few milliseconds ahead of the host. Wait until the
  // actual host clock reaches the recorded claim; never forge/backdate evidence
  // or relax either DB or worker time checks. Larger skew remains a hard denial.
  // +1 ms preserves the PostgreSQL fractional-microsecond lower bound that
  // Date.parse truncates. Scan timestamps still come from the real host clock.
  const clockWaitMs = Math.max(0, Date.parse(claim.claimedAt)+1-Date.now());
  assert(Number.isFinite(clockWaitMs) && clockWaitMs<=2000, 'CLAIM_CLOCK_SKEW');
  if (clockWaitMs>0) await new Promise(resolve=>setTimeout(resolve,Math.ceil(clockWaitMs)));
  assert(Date.now() >= Date.parse(claim.claimedAt) && Date.now() < Date.parse(claim.expiresAt), 'CLAIM_TIME_INVALID');
  assert(Date.now()/1000-report.dailyTimestampSeconds+360<=86400, 'CLAIM_CVD_STALE');
  assert(sha(bytes)===claim.checksumHex && bytes.length===claim.byteLength, 'CLAIM_BYTES_MISMATCH');
  const scanStartedAt = new Date().toISOString();
  const result = await job('scan',Buffer.from(bytes),claim.nonce);
  const scanCompletedAt = new Date().toISOString();
  assert(Date.parse(scanCompletedAt)<=Date.parse(claim.expiresAt), 'CLAIM_SCAN_DEADLINE');
  const raw = JSON.stringify({ taskId:claim.taskId,attempt:claim.attempt,fence:claim.fence,
    scanStartedAt,scanCompletedAt,clockWaitMs,result,cleanup:report.lastJob });
  const sandboxEvidenceSha256 = sha(raw);
  await writeFile(`${output}/bound-${sandboxEvidenceSha256}.json`,raw,{mode:0o600,flag:'wx'});
  return { taskId:claim.taskId,nonce:claim.nonce,attempt:claim.attempt,fence:claim.fence,
    sourceSha256:result.sourceSha256,byteLength:result.byteLength,policy:claim.policy,
    scanStartedAt,scanCompletedAt,outcome:result.status==='clean'?'clean':
      (result.detectionNames??[]).some((n:string|undefined)=>typeof n==='string'&&n.startsWith('Heuristics.'))?'scan_failed':'infected',
    exitCode:result.nativeExitCode,sandboxEvidenceSha256 };
}
