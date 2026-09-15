import { open, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { R1ClamAvInvocation } from "./clamav-adapter";
import { scanWithR1ClamAv } from "./clamav-adapter";

describe("R1 ClamAV adapter", () => {
  let root: string;
  let input: R1ClamAvInvocation;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'r1-adapter-'));
    await writeFile(join(root, 'fixture'), 'x');
    input = { file: await open(join(root, 'fixture'), 'r'), byteLength: 1, checksumHex: 'a'.repeat(64), timeoutMs: 300_000 };
  });
  afterAll(async () => { await input.file.close(); await rm(root, { recursive: true, force: true }); });
  it.each([[0, false, "clean"], [1, false, "infected"], [2, false, "scan_failed"], [null, false, "scan_failed"], [0, true, "scan_failed"]] as const)("fails closed for scanner result", async (exitCode, timedOut, expected) => {
    await expect(scanWithR1ClamAv({ run: async () => ({ exitCode, timedOut, output: "" }) }, input)).resolves.toBe(expected);
  });
  it("fails closed when the runner rejects or exceeds the adapter deadline", async () => {
    await expect(scanWithR1ClamAv({ run: async () => { throw new Error("spawn_failed"); } }, input)).resolves.toBe("scan_failed");
    await expect(scanWithR1ClamAv({ run: async () => new Promise(() => {}) }, { ...input, timeoutMs: 1 })).resolves.toBe("scan_failed");
  });
  it.each([NaN, Infinity, 0, 1.5, 300_001])('rejects invalid deadline %s before invocation', async (timeoutMs) => {
    const run = vi.fn();
    expect(await scanWithR1ClamAv({ run }, { ...input, timeoutMs })).toBe('scan_failed');
    expect(run).not.toHaveBeenCalled();
  });
  it('signals the runner to stop when its deadline expires', async () => {
    const abort = vi.fn();
    const run = async (_input: R1ClamAvInvocation, signal: AbortSignal) => {
      signal.addEventListener('abort', abort);
      return new Promise<never>(() => {});
    };
    expect(await scanWithR1ClamAv({ run }, { ...input, timeoutMs: 5 })).toBe('scan_failed');
    expect(abort).toHaveBeenCalledTimes(1);
  });
});
