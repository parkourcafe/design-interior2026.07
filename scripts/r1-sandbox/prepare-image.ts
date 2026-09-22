import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, mkdir, copyFile, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { DockerClient } from "../../lib/integration-gateway/r1-sandbox/docker";

async function main() {
  // Offline assembly only: create/copy/commit a stopped container, never pull/run/build packages.
  const base = "sha256:6d4efb6af4f10a0cae2e396215880086ace64a0d409849a47adf88e07c095430";
  const endpoint = process.argv[2];
  if (!endpoint) throw new Error("sandbox_explicit_endpoint_required");
  const docker = new DockerClient({ executable: "/opt/homebrew/bin/docker", endpoint });
  const source = resolve("scripts/r1-sandbox/probe.mjs");
  const sourceSha256 = createHash("sha256").update(await readFile(source)).digest("hex");
  const root = await mkdtemp(join(tmpdir(), "r1-synthetic-image-"));
  let id: string | undefined;
  let manifest: unknown;
  try {
    await mkdir(join(root, "opt", "r1"), { recursive: true });
    await copyFile(source, join(root, "opt", "r1", "probe.mjs"));
    await writeFile(join(root, "opt", "r1", "dac-writable"), "synthetic-dac-fixture");
    await chmod(join(root, "opt", "r1", "dac-writable"), 0o666);
    const created = await docker.command(["create", "--pull=never", "--name", `r1-image-prep-${randomUUID()}`, base]);
    id = created.stdout.trim();
    if (created.code || !/^[a-f0-9]{64}$/.test(id)) throw new Error("offline_image_create_failed");
    const copied = await docker.command(["cp", `${root}/opt/.`, `${id}:/opt`]);
    if (copied.code) throw new Error("offline_image_copy_failed");
    const committed = await docker.command(["commit", "--change", "USER 65532:65532", "--change", 'ENTRYPOINT ["/usr/local/bin/node"]',
      "--change", `LABEL r1.synthetic.source=${sourceSha256}`, id], 15_000);
    if (committed.code || !/^sha256:[a-f0-9]{64}$/.test(committed.stdout.trim())) throw new Error("offline_image_commit_failed");
    manifest = { imageId: committed.stdout.trim(), probeSourceSha256: sourceSha256, base, level: "synthetic-only" };
  } finally {
    if (id && /^[a-f0-9]{64}$/.test(id)) {
      const result = await docker.command(["rm", id]);
      if (result.code || await docker.inspect(id)) throw new Error("offline_image_cleanup_unconfirmed");
    }
    await rm(root, { recursive: true, force: true });
  }
  process.stdout.write(JSON.stringify(manifest) + "\n");
}
void main().catch(() => { process.stderr.write("sandbox_cli_failed\n"); process.exitCode = 1; });
