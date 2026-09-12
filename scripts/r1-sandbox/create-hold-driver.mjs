#!/usr/bin/env node
// Fixed local transport fault harness: real Docker create succeeds, but its reply
// is withheld. No customer inputs; only the dedicated synthetic supervisor uses it.
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const hold = args.includes('create');
const child = spawn('/opt/homebrew/bin/docker', args, { shell: false, stdio: hold ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
if (!hold) {
  child.on('error', () => process.exit(1));
  child.on('exit', code => process.exit(code ?? 1));
} else {
  let output = ''; let bytes = 0;
  child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 65_536) child.kill('SIGKILL'); else output += chunk.toString('utf8'); });
  child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 65_536) child.kill('SIGKILL'); });
  child.on('error', () => process.exit(1));
  child.on('exit', code => {
    if (code !== 0 || !/^[a-f0-9]{64}$/.test(output.trim())) process.exit(1);
    setInterval(() => {}, 1000);
  });
}
