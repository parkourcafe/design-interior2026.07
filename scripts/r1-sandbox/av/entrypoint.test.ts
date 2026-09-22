import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseImageEntrypointArguments, runImageEntrypoint } from "./entrypoint";
import { runAvEntrypoint } from "../../../lib/integration-gateway/r1-sandbox/av-entrypoint";
vi.mock("../../../lib/integration-gateway/r1-sandbox/av-entrypoint", () => ({ runAvEntrypoint: vi.fn() }));
const digest = "a".repeat(64);
const args = ["--manifest-sha256", digest, "--remaining-ms", "1000"];
afterEach(() => vi.resetAllMocks());

describe("image CLI strict arguments and signal ownership", () => {
  it.each(["1", "300000"])("accepts canonical boundary %s", value => {
    expect(parseImageEntrypointArguments(["--manifest-sha256", digest, "--remaining-ms", value])).toEqual({ expectedManifestSha256: digest, remainingMs: Number(value) });
  });
  it.each([[], [...args, "extra"], ["--remaining-ms", "1000", "--manifest-sha256", digest], ["--manifest-sha256=" + digest, "--remaining-ms", "1000"],
    ["--manifest-sha256", "A".repeat(64), "--remaining-ms", "1"], ["--manifest-sha256", digest + "\n", "--remaining-ms", "1"],
    ...["0", "01", "+1", "1.0", "1e3", " 1", "1 ", "1\n", "300001", "999999999999999999", "-1"].map(value => ["--manifest-sha256", digest, "--remaining-ms", value])].map(argv => ({ argv })))("rejects noncanonical/extra arguments $argv", ({ argv }) => {
    expect(parseImageEntrypointArguments(argv)).toBeNull();
  });
  it("does not call the receiver or register handlers for invalid arguments", async () => {
    const before = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
    expect(await runImageEntrypoint([])).toBe(2); expect(runAvEntrypoint).not.toHaveBeenCalled();
    expect([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")]).toEqual(before);
  });
  it.each(["terminal_written", "no_result", "throw"] as const)("maps receiver %s and always removes handlers", async result => {
    const before = [process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")];
    vi.mocked(runAvEntrypoint).mockImplementation(async input => {
      expect(input).toMatchObject({ expectedManifestSha256: digest, remainingMs: 1000, stdin: process.stdin, stdout: process.stdout });
      expect(input.signal.aborted).toBe(false);
      if (result === "throw") throw new Error("private diagnostic"); return result;
    });
    expect(await runImageEntrypoint(args)).toBe(result === "terminal_written" ? 0 : 1);
    expect([process.listenerCount("SIGTERM"), process.listenerCount("SIGINT")]).toEqual(before);
  });
});

let root: string; let actualBundle: string;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "r1-av-cli-test-")); actualBundle = join(root, "actual.cjs");
  await bundle(actualBundle);
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
async function bundle(outfile: string, stub?: string) {
  await build({ entryPoints: [resolve("scripts/r1-sandbox/av/entrypoint.ts")], outfile, bundle: true, platform: "node", format: "cjs", target: "node22", logLevel: "silent",
    plugins: stub === undefined ? [] : [{ name: "protocol-only-fixture", setup(builder) {
      builder.onLoad({ filter: /lib\/integration-gateway\/r1-sandbox\/av-entrypoint\.ts$/ }, () => ({ contents: stub, loader: "ts" }));
    } }],
  });
}
async function execute(path: string, argv = args, signal?: "SIGTERM" | "SIGINT") {
  const child = spawn(process.execPath, [path, ...argv], { stdio: ["pipe", "pipe", "pipe", "ipc"] });
  const { stdin, stdout: out, stderr: err } = child;
  if (!stdin || !out || !err) { child.kill("SIGKILL"); throw new Error("cli_test_pipes_missing"); }
  let stdout = "", stderr = ""; let timer: ReturnType<typeof setTimeout> | undefined; let acknowledged = false;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
  });
  out.on("data", bytes => { stdout += bytes; }); err.on("data", bytes => { stderr += bytes; });
  const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("cli_test_timeout")); }, 5000); });
  if (signal) child.on("message", message => {
    if ((message as { type?: string }).type === "receiver_invoked") { acknowledged = true; child.kill(signal); }
  });
  stdin.end();
  try { return { ...await Promise.race([exited, deadline]), stdout, stderr, acknowledged }; }
  finally { if (timer) clearTimeout(timer); child.kill("SIGKILL"); await exited; }
}
describe("compiled CJS image entrypoint in real subprocesses; no scanner/image execution", () => {
  it("executes the actual bundle and rejects invalid arguments without noise", async () => {
    expect(await execute(actualBundle, [])).toMatchObject({ code: 2, signal: null, stdout: "", stderr: "" });
  });
  it("actual receiver is invoked and fails closed on an unconfigured local runtime (not inert exit 0)", async () => {
    expect(await execute(actualBundle)).toMatchObject({ code: 1, signal: null, stdout: "", stderr: "" });
  });
  it.each(["terminal_written", "no_result", "throw"] as const)("compiled wrapper calls the exact receiver export and maps %s", async result => {
    const path = join(root, `${result}.cjs`);
    await bundle(path, `export async function runAvEntrypoint(input) { if (input.expectedManifestSha256 !== '${digest}' || input.remainingMs !== 1000) throw new Error('invalid_binding'); ${result === "throw" ? "throw new Error('private diagnostic')" : `return '${result}'`}; }`);
    expect(await execute(path)).toMatchObject({ code: result === "terminal_written" ? 0 : 1, signal: null, stdout: "", stderr: "" });
  });
  it.each(["SIGTERM", "SIGINT"] as const)("forwards %s to receiver cancellation and returns nonzero", async signal => {
    const path = join(root, `${signal}.cjs`);
    await bundle(path, `export async function runAvEntrypoint(input) { process.send({type:'receiver_invoked'}); return await new Promise(resolve => { const keepalive=setInterval(()=>{},1000); input.signal.addEventListener('abort',()=>{clearInterval(keepalive);resolve('terminal_written')},{once:true}); }); }`);
    expect(await execute(path, args, signal)).toMatchObject({ code: 1, signal: null, stdout: "", stderr: "", acknowledged: true });
  });
});
