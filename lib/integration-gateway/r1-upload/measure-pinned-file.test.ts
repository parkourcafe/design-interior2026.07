import { createHash } from "node:crypto";
import { mkdtemp, open, writeFile, rm, link, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { errorEnvelope, ProjectIntelligenceAdapterError } from "@/lib/project-intelligence/adapters/postgres/errors";
import { measurePinnedFile } from "./measure-pinned-file";

const roots: string[] = [];
const handles: FileHandle[] = [];
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(handles.splice(0).map(file => file.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});
async function fixture(bytes = Buffer.from("synthetic pinned input")) {
  const root = await mkdtemp(join(tmpdir(), "r1-measure-test-"));
  roots.push(root);
  const path = join(root, "input");
  await writeFile(path, bytes);
  const file = await open(path, "r");
  handles.push(file);
  const controller = new AbortController();
  return { root, path, bytes, file, controller, input: { file, observedByteLength: bytes.length, signal: controller.signal } };
}

/** Intercepts one descriptor operation while retaining real OS reads/stats. */
function intercepted(file: FileHandle, method: "read" | "stat", invoke: (args: unknown[], call: () => Promise<unknown>) => Promise<unknown>): FileHandle {
  return new Proxy(file, {
    get(target, property) {
      if (property === method) return (...args: unknown[]) => invoke(args, () => Reflect.apply(target[method], target, args));
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("pinned descriptor byte measurement", () => {
  it("hashes offset zero in bounded chunks, probes EOF and neither moves nor closes the borrowed descriptor", async () => {
    const f = await fixture(Buffer.alloc(2 * 65_536 + 7, 0x5a));
    await f.file.read(Buffer.alloc(3), 0, 3, null);
    const close = vi.spyOn(f.file, "close");
    const requests: unknown[][] = [];
    const file = intercepted(f.file, "read", async (args, call) => { requests.push(args); return call(); });
    expect(await measurePinnedFile({ ...f.input, file })).toEqual({ sourceSha256: digest(f.bytes), byteLength: f.bytes.length });
    expect(requests.map(args => args[2])).toEqual([65_536, 65_536, 7, 1]);
    expect(requests.map(args => args[3])).toEqual([0, 65_536, 131_072, 131_079]);
    expect(close).not.toHaveBeenCalled();
    const next = Buffer.alloc(1);
    await f.file.read(next, 0, 1, null);
    // Explicit reads above leave the sequential position at 3, then this read advances to 4.
    const position = await f.file.read(Buffer.alloc(f.bytes.length), 0, f.bytes.length, null);
    expect(position.bytesRead).toBe(f.bytes.length - 4);
  });
  it("continues positive short reads from the actual bytesRead", async () => {
    const f = await fixture(Buffer.from("abcdefghij"));
    const offsets: unknown[] = [];
    const file = intercepted(f.file, "read", async (args) => {
      offsets.push(args[3]);
      const buffer = args[0] as Buffer;
      return f.file.read(buffer, 0, Math.min(Number(args[2]), 2), Number(args[3]));
    });
    expect(await measurePinnedFile({ ...f.input, file })).toEqual({ sourceSha256: digest(f.bytes), byteLength: 10 });
    expect(offsets).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 100_000_001])("rejects invalid trusted length %s before reading", async (observedByteLength) => {
    const f = await fixture();
    const read = vi.spyOn(f.file, "read");
    await expect(measurePinnedFile({ ...f.input, observedByteLength })).rejects.toMatchObject({ reason: "pinned_measurement_invalid" });
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects initial size mismatch, a directory and a hard-linked input", async () => {
    const f = await fixture();
    await expect(measurePinnedFile({ ...f.input, observedByteLength: f.bytes.length + 1 })).rejects.toMatchObject({ reason: "pinned_measurement_invalid" });
    await link(f.path, join(f.root, "second-link"));
    await expect(measurePinnedFile(f.input)).rejects.toMatchObject({ reason: "pinned_measurement_invalid" });
    const directory = await open(f.root, "r");
    handles.push(directory);
    await expect(measurePinnedFile({ ...f.input, file: directory })).rejects.toMatchObject({ reason: "pinned_measurement_invalid" });
  });
  it("fails on premature zero read and bytes appearing at EOF", async () => {
    const f = await fixture();
    const zero = intercepted(f.file, "read", async () => ({ bytesRead: 0 }));
    await expect(measurePinnedFile({ ...f.input, file: zero })).rejects.toMatchObject({ reason: "pinned_measurement_changed" });
    const grown = intercepted(f.file, "read", async (args, call) => args[3] === f.bytes.length ? { bytesRead: 1 } : call());
    await expect(measurePinnedFile({ ...f.input, file: grown })).rejects.toMatchObject({ reason: "pinned_measurement_changed" });
  });
  it.each(["dev", "ino", "mode", "nlink", "size", "mtimeNs", "ctimeNs"] as const)("rejects changed %s at the final stat", async (field) => {
    const f = await fixture();
    let calls = 0;
    const file = intercepted(f.file, "stat", async (_args, call) => {
      const stats = await call() as Awaited<ReturnType<typeof f.file.stat>>;
      if (++calls === 2) Reflect.set(stats, field, BigInt(Reflect.get(stats, field)) + 1n);
      return stats;
    });
    await expect(measurePinnedFile({ ...f.input, file })).rejects.toMatchObject({ reason: "pinned_measurement_changed" });
  });
  it.each(["before", "read", "eof", "final_stat"] as const)("aborts %s without closing or exposing signal reason", async (phase) => {
    const f = await fixture();
    const close = vi.spyOn(f.file, "close");
    if (phase === "before") f.controller.abort("private-path-abort-reason");
    let statCalls = 0;
    const file = phase === "final_stat"
      ? intercepted(f.file, "stat", async (_args, call) => {
          const result = await call();
          if (++statCalls === 2) f.controller.abort("private-path-abort-reason");
          return result;
        })
      : intercepted(f.file, "read", async (args, call) => {
          const result = await call();
          if (phase === "read" || (phase === "eof" && args[3] === f.bytes.length)) f.controller.abort("private-path-abort-reason");
          return result;
        });
    let failure: unknown;
    try { await measurePinnedFile({ ...f.input, file }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: "validation_failed", reason: "pinned_measurement_aborted" });
    expect(JSON.stringify(errorEnvelope("request-1", failure as ProjectIntelligenceAdapterError))).not.toContain("private-path");
    expect(close).not.toHaveBeenCalled();
    expect(f.file.fd).toBeGreaterThan(2);
  });
  it.each(["initial_stat", "read", "eof", "final_stat"] as const)("preserves detected %s failure when cancellation arrives with its result", async (phase) => {
    const f = await fixture();
    let statCalls = 0;
    const file = phase === "initial_stat" || phase === "final_stat"
      ? intercepted(f.file, "stat", async (_args, call) => {
          const stats = await call() as Awaited<ReturnType<typeof f.file.stat>>;
          if (++statCalls === (phase === "initial_stat" ? 1 : 2)) {
            Reflect.set(stats, "size", BigInt(Reflect.get(stats, "size")) + 1n);
            f.controller.abort("simultaneous-cancellation");
          }
          return stats;
        })
      : intercepted(f.file, "read", async (args, call) => {
          if (phase === "read" || args[3] === f.bytes.length) {
            f.controller.abort("simultaneous-cancellation");
            return { bytesRead: phase === "read" ? 0 : 1 };
          }
          return call();
        });
    await expect(measurePinnedFile({ ...f.input, file })).rejects.toMatchObject({
      reason: phase === "initial_stat" ? "pinned_measurement_invalid" : "pinned_measurement_changed",
    });
  });
  it("sanitizes filesystem failure and leaves descriptor ownership with the caller", async () => {
    const f = await fixture();
    const close = vi.spyOn(f.file, "close");
    const file = intercepted(f.file, "read", async () => { throw new Error("EIO /private/synthetic-path"); });
    await expect(measurePinnedFile({ ...f.input, file })).rejects.toMatchObject({ message: "project_ceo.validation_failed", reason: "pinned_measurement_failed" });
    expect(close).not.toHaveBeenCalled();
  });
});
