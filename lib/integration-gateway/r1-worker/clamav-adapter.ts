export type R1ClamAvResult = "clean" | "infected" | "scan_failed";

export interface R1ClamAvInvocation {
  readonly executable: string;
  readonly databaseDirectory: string;
  readonly filePath: string;
  readonly timeoutMs: number;
}

export interface R1ClamAvRunner {
  run(input: R1ClamAvInvocation): Promise<{ readonly exitCode: number | null; readonly timedOut: boolean; readonly output: string }>;
}

export async function scanWithR1ClamAv(runner: R1ClamAvRunner, input: R1ClamAvInvocation): Promise<R1ClamAvResult> {
  if (!input.executable || !input.databaseDirectory || !input.filePath || input.timeoutMs < 1 || input.timeoutMs > 300_000) return "scan_failed";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      runner.run(input),
      new Promise<{ readonly exitCode: null; readonly timedOut: true; readonly output: string }>((resolve) => {
        timer = setTimeout(() => resolve({ exitCode: null, timedOut: true, output: "" }), input.timeoutMs);
      }),
    ]);
    if (result.timedOut || result.exitCode === null) return "scan_failed";
    if (result.exitCode === 0) return "clean";
    if (result.exitCode === 1) return "infected";
    return "scan_failed";
  } catch {
    return "scan_failed";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
