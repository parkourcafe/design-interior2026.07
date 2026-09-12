import { DockerClient } from "../../lib/integration-gateway/r1-sandbox/docker";
import { SandboxRegistry } from "../../lib/integration-gateway/r1-sandbox/registry";
import { runWatchdog } from "../../lib/integration-gateway/r1-sandbox/watchdog";
async function main() {
  const [registryPath, profile, endpoint, expectedDaemonId] = process.argv.slice(2);
  if (!registryPath || !profile || !endpoint || !expectedDaemonId) throw new Error("sandbox_registry_required");
  const registry = new SandboxRegistry(registryPath);
  const controller = new AbortController();
  process.on("SIGTERM", () => controller.abort());
  process.on("SIGINT", () => controller.abort());
  try {
    await runWatchdog({ registry, docker: new DockerClient({ executable: "/opt/homebrew/bin/docker", endpoint }), colimaExecutable: "/opt/homebrew/bin/colima", profile, expectedDaemonId }, controller.signal);
  } finally { registry.close(); }
}
void main().catch(() => { process.stderr.write("sandbox_cli_failed\n"); process.exitCode = 1; });
