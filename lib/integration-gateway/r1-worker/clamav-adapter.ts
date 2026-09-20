import type { FileHandle } from "node:fs/promises";

export type R1ClamAvResult = "clean" | "infected" | "scan_failed";

export interface R1ClamAvInvocation {
  /** Borrowed read-only descriptor of a pinned worker-owned generation. */
  readonly file: FileHandle;
  readonly byteLength: number;
  readonly checksumHex: string;
  readonly timeoutMs: number;
}

export interface R1ClamAvRunner {
  run(input: R1ClamAvInvocation, signal: AbortSignal): Promise<{ readonly exitCode: number | null; readonly timedOut: boolean }>;
}

export async function scanWithR1ClamAv(runner: R1ClamAvRunner, input: R1ClamAvInvocation): Promise<R1ClamAvResult> {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 300_000
    || !Number.isSafeInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > 100_000_000
    || !/^[a-f0-9]{64}$/.test(input.checksumHex)) return "scan_failed";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    const result = await Promise.race([
      runner.run(input, controller.signal),
      new Promise<{ readonly exitCode: null; readonly timedOut: true }>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ exitCode: null, timedOut: true });
        }, input.timeoutMs);
      }),
    ]);
    if (result.timedOut || result.exitCode === null) return "scan_failed";
    if (result.exitCode === 0) return "clean";
    if (result.exitCode === 1) return "infected";
    return "scan_failed";
  } catch {
    return "scan_failed";
  } finally {
    controller.abort();
    if (timer) clearTimeout(timer);
  }
}
