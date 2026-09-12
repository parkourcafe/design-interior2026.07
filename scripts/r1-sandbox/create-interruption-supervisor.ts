import { resolve } from "node:path";
import { DockerClient } from "../../lib/integration-gateway/r1-sandbox/docker";
import { SandboxRegistry } from "../../lib/integration-gateway/r1-sandbox/registry";
import { runSyntheticProbe } from "../../lib/integration-gateway/r1-sandbox/executor";
import { PROBE_MODES, type ProbeMode } from "../../lib/integration-gateway/r1-sandbox/profile";
async function main() {
  const [registryPath, imageId, probeSourceSha256, mode, profile, endpoint, expectedDaemonId] = process.argv.slice(2);
  if (!registryPath || !imageId || !probeSourceSha256 || !profile || !endpoint || !expectedDaemonId || !PROBE_MODES.includes(mode as ProbeMode)) throw new Error("sandbox_arguments_invalid");
  const registry = new SandboxRegistry(registryPath);
  const controller = new AbortController();
  process.on("SIGTERM", () => controller.abort());
  process.on("SIGINT", () => controller.abort());
  try {
    const result = await runSyntheticProbe({ registry, docker: new DockerClient({ executable: resolve("scripts/r1-sandbox/create-hold-driver.mjs"), endpoint }),
      colimaExecutable: "/opt/homebrew/bin/colima", profile, expectedDaemonId, imageId, probeSourceSha256 }, mode as ProbeMode, controller.signal);
    process.stdout.write(JSON.stringify(result) + "\n");
    process.exitCode = result.outcome === "completed" ? 0 : 1;
  } catch (error) {
    process.stdout.write(JSON.stringify({ level: "synthetic-small-v1", outcome: "failed_closed", reason: error instanceof Error && /^sandbox_[a-z_]+$/.test(error.message) ? error.message : "sandbox_failed" }) + "\n");
    process.exitCode = 1;
  } finally { registry.close(); }
}
void main().catch(() => { process.stderr.write("sandbox_cli_failed\n"); process.exitCode = 1; });
