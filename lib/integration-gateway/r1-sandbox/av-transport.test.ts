import { createHash } from "node:crypto";
import { chmod, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DockerClient } from "./docker";
import { streamAvToContainer, streamPinnedAvInput } from "./av-transport";
const roots: string[] = []; const handles: Awaited<ReturnType<typeof open>>[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const file of handles.splice(0)) await file.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const manifestSha256 = "a".repeat(64);
const ready = `process.stdout.write(JSON.stringify({protocol:'r1-av-wire/v1',kind:'ready',runtimeManifestSha256:'${manifestSha256}'})+'\\n');`;
async function fixture(script: string, size = 200000) {
  const root = await mkdtemp(join(tmpdir(), "r1-av-pipe-test-")); roots.push(root);
  const executable = join(root, "fake-docker"); await writeFile(executable, `#!${process.execPath}\n${script}`); await chmod(executable, 0o700);
  const bytes = Buffer.alloc(size); for (let i = 0; i < size; i++) bytes[i] = i % 251; const path = join(root, "source"); await writeFile(path, bytes); const file = await open(path, "r"); handles.push(file);
  const snapshot = await file.stat({ bigint: true });
  const header = { byteLength: bytes.length, sourceSha256: createHash("sha256").update(bytes).digest("hex"), nonce: "b".repeat(32), timeoutMs: 2000 };
  const docker = new DockerClient({ executable, context: "fixture" });
  const input = { id: "c".repeat(64), file, snapshot, header, manifestSha256, timeoutMs: 2000, signal: new AbortController().signal };
  return { root, path, bytes, docker, input };
}
const receiver = `${ready}
const chunks=[];process.stdin.on('data',b=>{chunks.push(b);process.stdin.pause();setTimeout(()=>process.stdin.resume(),2)});
process.stdin.on('end',()=>{const b=Buffer.concat(chunks);const length=Number(b.readBigUInt64BE(8));
if(b.length!==68+length || require('node:crypto').createHash('sha256').update(b.subarray(68)).digest('hex')!==b.subarray(16,48).toString('hex'))process.exit(2);
process.stdout.write(JSON.stringify({protocol:'r1-av-wire/v1',kind:'scan_failed',runtimeManifestSha256:'${manifestSha256}',nonce:b.subarray(52,68).toString('hex'),sourceSha256:b.subarray(16,48).toString('hex'),byteLength:length,reason:'scan_incomplete'})+'\\n');});`;
describe("AV attached binary transport with real local fake-CLI processes; no Docker/AV proof", () => {
  it("streams bounded chunks with backpressure, EOF, hash/nonce correlation and unchanged borrowed offset", async () => {
    const f = await fixture(receiver); await f.input.file.read(Buffer.alloc(7), 0, 7, null);
    expect((await streamAvToContainer(f.docker, f.input)).kind).toBe("scan_failed");
    const byte = Buffer.alloc(1); await f.input.file.read(byte, 0, 1, null); expect(byte[0]).toBe(f.bytes[7]);
    expect(await f.input.file.stat()).toBeTruthy();
  });
  it("continues positive short reads and never requests more than 64KiB", async () => {
    const f = await fixture(receiver);
    const file = new Proxy(f.input.file, { get(target, property) {
      if (property === "read") return (...args: unknown[]) => {
        expect(args[2]).toBeLessThanOrEqual(65536); args[2] = Math.min(Number(args[2]), 13);
        return Reflect.apply(target.read, target, args);
      };
      const value = Reflect.get(target, property, target); return typeof value === "function" ? value.bind(target) : value;
    } });
    let length = 0; for await (const chunk of streamPinnedAvInput({ ...f.input, file })) length += chunk.length;
    expect(length).toBe(f.bytes.length + 68);
  });
  it("rejects actual source replacement before streaming", async () => {
    const f = await fixture(receiver); await writeFile(f.path, Buffer.alloc(f.bytes.length, 43));
    expect((await streamAvToContainer(f.docker, f.input)).kind).toBe("no_result");
  });
  it.each(["process.exit(0)", `${ready}process.stdout.write('x'.repeat(65537));`, `${ready}process.stderr.write('private diagnostic');`, `${ready}setInterval(()=>{},1000);`])("refuses early exit, overflow, stderr and timeout", async script => {
    const f = await fixture(script); expect((await streamAvToContainer(f.docker, { ...f.input, timeoutMs: 300 })).kind).toBe("no_result");
  });
  it("reaps a process killed during attached streaming, retaining the borrowed FD", async () => {
    const f = await fixture(`${ready}require('node:fs').writeFileSync(__filename+'.pid',String(process.pid));process.stdin.once('data',()=>process.kill(process.pid,'SIGKILL'));`, 2000000);
    expect((await streamAvToContainer(f.docker, f.input)).kind).toBe("no_result");
    const pid = Number(await readFile(join(f.root, "fake-docker.pid"), "utf8")); expect(() => process.kill(pid, 0)).toThrow();
    expect(await f.input.file.stat()).toBeTruthy();
  });
});
