import { runAvEntrypoint } from "../../../lib/integration-gateway/r1-sandbox/av-entrypoint";
import { R1_WORKER_LIMITS } from "../../../lib/integration-gateway/r1-worker/policy";

export function parseImageEntrypointArguments(argv: readonly string[]): { expectedManifestSha256: string; remainingMs: number } | null {
  if (argv.length !== 4 || argv[0] !== "--manifest-sha256" || argv[2] !== "--remaining-ms"
    || typeof argv[1] !== "string" || !/^[a-f0-9]{64}$/.test(argv[1])
    || typeof argv[3] !== "string" || !/^[1-9][0-9]{0,5}$/.test(argv[3])) return null;
  const remainingMs = Number(argv[3]);
  if (remainingMs > R1_WORKER_LIMITS.wallTimeSeconds * 1000) return null;
  return { expectedManifestSha256: argv[1], remainingMs };
}

/** Fixed image CLI only. The library owns protocol output and resource cleanup;
 * this wrapper adds no environment, path or runner selectors and no diagnostics.
 */
export async function runImageEntrypoint(argv: readonly string[]): Promise<0 | 1 | 2> {
  const parsed = parseImageEntrypointArguments(argv);
  if (!parsed) return 2;
  const controller = new AbortController(); const abort = () => controller.abort();
  process.on("SIGTERM", abort); process.on("SIGINT", abort);
  try {
    const result = await runAvEntrypoint({ ...parsed, stdin: process.stdin, stdout: process.stdout, signal: controller.signal });
    return result === "terminal_written" && !controller.signal.aborted ? 0 : 1;
  } catch { return 1; }
  finally { process.removeListener("SIGTERM", abort); process.removeListener("SIGINT", abort); }
}

// The installed .cjs must execute, while importing the source in tests is inert.
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  void runImageEntrypoint(process.argv.slice(2)).then(code => { process.exitCode = code; }, () => { process.exitCode = 1; });
}
