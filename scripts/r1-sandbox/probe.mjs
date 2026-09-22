// Fixed synthetic harness. No AV, customer data, network services or host mounts.
import { readFile, writeFile, chmod, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import net from 'node:net';
const mode = process.argv[2];
const modes = new Set(['observe', 'cpu', 'pids', 'memory', 'wait', 'readonly-negative-control']);
if (!modes.has(mode)) process.exit(2);
const text = path => readFile(path, 'utf8');
const evidence = {
  uid: process.getuid(), gid: process.getgid(),
  status: Object.fromEntries((await text('/proc/self/status')).split('\n').filter(line => /^(CapEff|NoNewPrivs|Seccomp):/.test(line)).map(line => line.split(/:\s*/))),
  cpuMax: (await text('/sys/fs/cgroup/cpu.max')).trim(),
  memoryMax: (await text('/sys/fs/cgroup/memory.max')).trim(),
  swapMax: (await text('/sys/fs/cgroup/memory.swap.max')).trim(),
  pidsMax: (await text('/sys/fs/cgroup/pids.max')).trim(),
};
let rootWriteDenied = false;
let writeSucceeded = false;
try { await writeFile('/opt/r1/dac-writable', 'synthetic'); writeSucceeded = true; }
catch (error) { rootWriteDenied = error.code === 'EROFS'; evidence.rootfsWriteError = error.code; }
if (mode === 'readonly-negative-control') {
  process.stdout.write(JSON.stringify({ level: 'synthetic-readonly-negative-control-v1', mode, ok: writeSucceeded,
    negativeEvidence: { uid: process.getuid(), writeSucceeded } }));
  process.exit(writeSucceeded ? 0 : 3);
}
await writeFile('/scratch/test', '#!/bin/sh\nexit 0\n', { mode: 0o700 });
await chmod('/scratch/test', 0o700);
const noExec = await new Promise(resolve => {
  const child = spawn('/scratch/test', [], { stdio: 'ignore' });
  child.on('error', error => resolve(error.code === 'EACCES'));
  child.on('close', code => { if (code === 0) resolve(false); });
});
await unlink('/scratch/test');
const netDenied = await new Promise(resolve => {
  const socket = net.connect({ host: '192.0.2.1', port: 9 });
  const timer = setTimeout(() => { socket.destroy(); resolve(true); }, 500);
  socket.on('connect', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
  socket.on('error', () => { clearTimeout(timer); resolve(true); });
});
const interfaces = (await text('/proc/net/dev')).split('\n').slice(2).map(line => line.split(':')[0]?.trim()).filter(Boolean);
const baseOk = evidence.uid === 65532 && evidence.gid === 65532 && evidence.status.CapEff === '0000000000000000'
  && evidence.status.NoNewPrivs === '1' && evidence.status.Seccomp === '2'
  && evidence.cpuMax === '100000 100000' && evidence.memoryMax === '268435456'
  && evidence.swapMax === '0' && evidence.pidsMax === '32' && rootWriteDenied && noExec
  && netDenied && interfaces.every(name => name === 'lo');
if (!baseOk) { process.stdout.write(JSON.stringify({ level: 'synthetic-small-v1', mode, ok: false, evidence })); process.exit(3); }
if (mode === 'wait') {
  spawn('/usr/local/bin/node', ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  setInterval(() => {}, 1_000);
} else if (mode === 'memory') {
  const buffers = [];
  for (;;) { buffers.push(Buffer.alloc(8 * 1024 * 1024, 0x5a)); await new Promise(r => setTimeout(r, 5)); }
} else if (mode === 'pids') {
  const children = [];
  const initialEvents = Number((await text('/sys/fs/cgroup/pids.events')).match(/^max (\d+)$/m)?.[1] ?? 0);
  let denied = false;
  for (let i = 0; i < 64; i++) {
    const child = spawn('/bin/sleep', ['20'], { stdio: 'ignore' });
    const failed = await new Promise(resolve => { child.once('spawn', () => resolve(false)); child.once('error', error => resolve(error.code === 'EAGAIN' ? 'pids_denied' : 'other_failure')); });
    if (failed) { denied = failed === 'pids_denied'; break; }
    children.push(child);
  }
  await Promise.all(children.map(child => new Promise(resolve => { child.once('close', resolve); child.kill('SIGKILL'); })));
  const pidLimitEvents = Number((await text('/sys/fs/cgroup/pids.events')).match(/^max (\d+)$/m)?.[1] ?? 0) - initialEvents;
  process.stdout.write(JSON.stringify({ level: 'synthetic-small-v1', mode, ok: denied && children.length > 0 && pidLimitEvents > 0, evidence, childrenStarted: children.length, pidLimitEvents }));
} else if (mode === 'cpu') {
  const before = await text('/sys/fs/cgroup/cpu.stat');
  const children = [0, 1].map(() => spawn('/usr/local/bin/node', ['-e', 'const end=Date.now()+2500;while(Date.now()<end){}'], { stdio: 'ignore' }));
  await Promise.all(children.map(child => new Promise(resolve => child.once('close', resolve))));
  const after = await text('/sys/fs/cgroup/cpu.stat');
  const throttle = value => Number(value.match(/^nr_throttled (\d+)$/m)?.[1] ?? 0);
  process.stdout.write(JSON.stringify({ level: 'synthetic-small-v1', mode, ok: throttle(after) > throttle(before), evidence, throttledPeriods: throttle(after) - throttle(before) }));
} else process.stdout.write(JSON.stringify({ level: 'synthetic-small-v1', mode, ok: true, evidence }));
