import { DockerClient } from "../docker";
import { cleanupOwned } from "../lifecycle";
import { SandboxRegistry } from "../registry";

async function main() {
  const [path, operationId] = process.argv.slice(2);
  if (!path || !operationId || !process.send) throw new Error("cleanup_cutpoint_arguments_invalid");
  const registry = new SandboxRegistry(path);
  const docker = new DockerClient({ executable: "/controlled/docker", context: "cutpoint" });
  // cleanupOwned has committed its claim before reaching this transport method.
  // No Docker I/O is performed: the real child is killed while blocked here.
  docker.inspect = async () => {
    // A pending Promise alone does not keep Node alive. The parent must kill
    // this child; a bounded failsafe prevents orphaning it if the test aborts.
    setTimeout(() => process.exit(2), 10_000);
    process.send?.({ type: "claim_committed_before_docker_io" });
    return new Promise<never>(() => {});
  };
  docker.command = async () => { throw new Error("unexpected_cutpoint_command"); };
  try { await cleanupOwned(docker, registry, operationId); }
  finally { registry.close(); }
}
void main().catch(() => { process.exitCode = 1; });
