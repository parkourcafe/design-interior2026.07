import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { DockerClient } from "../docker";
import { SandboxRegistry } from "../registry";
import { streamAvToContainer } from "../av-transport";

/** Controlled subprocess cut point only. No daemon or real input is used. */
async function main() {
  const [registryPath, operationId, path, executable] = process.argv.slice(2);
  if (!registryPath || !operationId || !path || !executable || !process.send) throw new Error("av_cutpoint_invalid");
  const registry = new SandboxRegistry(registryPath); const record = registry.read(operationId);
  if (!record?.av || !record.containerId) throw new Error("av_cutpoint_invalid");
  const file = await open(path, "r"); const snapshot = await file.stat({ bigint: true });
  const bytes = await file.readFile(); // Bounded synthetic fixture only, not the production transport.
  const proxy = new Proxy(file, { get(target, key) {
    if (key === "read") return async (...args: unknown[]) => {
      if (Number(args[3]) > 0) {
        process.send?.({ type: "attached_streaming_cutpoint" });
        setTimeout(() => process.exit(2), 10000);
        return new Promise<never>(() => {});
      }
      return Reflect.apply(target.read, target, args);
    };
    const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value;
  } });
  try {
    await streamAvToContainer(new DockerClient({ executable, context: "fixture" }), { id: record.containerId, file: proxy, snapshot,
      header: { byteLength: Number(snapshot.size), sourceSha256: createHash("sha256").update(bytes).digest("hex"), nonce: record.nonce, timeoutMs: 9000 },
      manifestSha256: record.av.manifestSha256, timeoutMs: 9000, signal: new AbortController().signal });
  } finally { await file.close(); registry.close(); }
}
void main().catch(() => { process.exitCode = 1; });
