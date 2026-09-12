import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { z } from "zod";

export const CLAMAV_IMAGE_PATHS = Object.freeze({
  manifest: "/opt/r1/runtime-manifest.json", nodeExecutable: "/opt/r1/bin/node", executable: "/opt/r1/bin/clamscan",
  entrypoint: "/opt/r1/av-entrypoint.cjs", databaseDirectory: "/opt/r1/cvd", scratchDirectory: "/scratch",
});
export const CLAMAV_CVD_NAMES = ["main.cvd", "daily.cvd", "bytecode.cvd"] as const;
export const CLAMAV_SIGNATURE_MAX_AGE_SECONDS = 86_400;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const file = z.object({ sha256, byteLength: z.number().int().positive().safe() }).strict();
const library = file.extend({ path: z.string().regex(/^\/(?:lib|usr\/lib|usr\/local\/lib)\/[A-Za-z0-9._/+@-]+$/)
  .refine(path => !path.split("/").some(segment => segment === "." || segment === ".." || segment === "" && path.indexOf("//") >= 0)) }).strict();
export const clamAvRuntimeManifestSchema = z.object({
  schemaVersion: z.literal("r1-av-runtime-manifest/v1"), protocolVersion: z.literal("r1-av-wire/v1"),
  scannerPolicyVersion: z.literal("r1-clamav-policy/v1"), buildReference: z.string().min(1).max(128),
  licenseReference: z.string().min(1).max(256), nodeExecutable: file, nodeVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  executable: file.extend({ version: z.string().regex(/^\d+\.\d+\.\d+$/) }).strict(), entrypoint: file,
  libraries: z.array(library).min(1).max(256),
  cvds: z.object({
    "main.cvd": file,
    "daily.cvd": file.extend({ version: z.number().int().positive().safe(), timestampSeconds: z.number().int().positive().safe() }).strict(),
    "bytecode.cvd": file,
  }).strict(),
  signatureBundleSha256: sha256,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.libraries.map(entry => entry.path)).size !== value.libraries.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "duplicate_library" });
  if (value.signatureBundleSha256 !== cvdBundleDigest(value.cvds)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "cvd_bundle_mismatch" });
});
export type ClamAvRuntimeManifest = z.infer<typeof clamAvRuntimeManifestSchema>;

/** Preserve the existing main/daily/bytecode hex-string concatenation algorithm. */
export function cvdBundleDigest(cvds: Readonly<Record<(typeof CLAMAV_CVD_NAMES)[number], { readonly sha256: string }>>): string {
  return createHash("sha256").update(CLAMAV_CVD_NAMES.map(name => cvds[name].sha256).join("")).digest("hex");
}
export function assertCvdFreshness(timestampSeconds: number, nowMs: number, remainingMs: number): void {
  if (![timestampSeconds, nowMs, remainingMs].every(Number.isSafeInteger) || timestampSeconds < 1 || nowMs < 0 || remainingMs < 0 || remainingMs > 300_000
    || !Number.isSafeInteger((timestampSeconds + CLAMAV_SIGNATURE_MAX_AGE_SECONDS) * 1000)
    || !Number.isSafeInteger(nowMs + remainingMs + 60_000)
    || timestampSeconds * 1000 > nowMs + 300_000
    || nowMs + remainingMs + 60_000 > (timestampSeconds + CLAMAV_SIGNATURE_MAX_AGE_SECONDS) * 1000) throw new Error("av_runtime_signatures_unavailable");
}
export function parseCvdDailyHeader(header: Uint8Array): { version: number; timestampSeconds: number } {
  const fields = Buffer.from(header).toString("ascii").trim().split(":");
  const version = Number(fields[2]); const timestampSeconds = Number(fields[8]);
  if (header.length !== 512 || fields.length !== 9 || fields[0] !== "ClamAV-VDB" || !Number.isSafeInteger(version) || version < 1 || !Number.isSafeInteger(timestampSeconds) || timestampSeconds < 1) throw new Error("av_runtime_cvd_header_invalid");
  return { version, timestampSeconds };
}

const verified = new WeakSet<object>();
export interface VerifiedReadonlyClamAvRuntime {
  readonly manifest: ClamAvRuntimeManifest;
  readonly manifestSha256: string;
}
export function assertVerifiedReadonlyClamAvRuntime(runtime: VerifiedReadonlyClamAvRuntime): void {
  if (!verified.has(runtime)) throw new Error("av_runtime_not_verified");
}

async function readBounded(path: string, limit: number, signal: AbortSignal): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const chunks: Buffer[] = []; let offset = 0;
    for (;;) {
      signal.throwIfAborted();
      const buffer = Buffer.alloc(Math.min(65_536, limit + 1 - offset));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead) break;
      offset += bytesRead;
      if (offset > limit) throw new Error("av_runtime_metadata_oversize");
      chunks.push(buffer.subarray(0, bytesRead));
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks, offset);
  } finally { await handle.close(); }
}

export function assertReadonlyImageOs(input: { platform: string; uid: number; gid: number; status: string; mountinfo: string; network: string }, paths: readonly string[]): void {
  if (input.platform !== "linux" || input.uid !== 65532 || input.gid !== 65532
    || !/^CapEff:\s+0+$/m.test(input.status) || !/^NoNewPrivs:\s+1$/m.test(input.status) || !/^Seccomp:\s+2$/m.test(input.status)) throw new Error("av_runtime_os_unavailable");
  const mounts = input.mountinfo.trim().split("\n").map(line => {
    const fields = line.split(" - ")[0]?.split(" ");
    if (!fields || fields.length < 6 || !fields[4] || !fields[5]) throw new Error("av_runtime_mount_invalid");
    return { point: fields[4].replace(/\\([0-7]{3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8))), options: fields[5].split(",") };
  });
  const covering = (path: string) => mounts.filter(m => m.point === "/" || path === m.point || path.startsWith(`${m.point}/`)).sort((a, b) => b.point.length - a.point.length)[0];
  for (const path of ["/", ...paths]) if (!covering(path)?.options.includes("ro")) throw new Error("av_runtime_not_readonly");
  const scratch = covering(CLAMAV_IMAGE_PATHS.scratchDirectory);
  if (scratch?.point !== "/scratch" || !["rw", "noexec", "nosuid", "nodev"].every(flag => scratch.options.includes(flag))) throw new Error("av_runtime_scratch_invalid");
  const interfaces = input.network.split("\n").slice(2).map(line => line.split(":")[0]?.trim()).filter(Boolean);
  if (!interfaces.includes("lo") || interfaces.some(name => name !== "lo")) throw new Error("av_runtime_network_unavailable");
}

async function verifyFile(path: string, expected: { sha256: string; byteLength: number }, signal: AbortSignal): Promise<void> {
  if (await realpath(path) !== path) throw new Error("av_runtime_path_not_canonical");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(expected.byteLength)) throw new Error("av_runtime_file_invalid");
    const hash = createHash("sha256"); let offset = 0; const buffer = Buffer.alloc(65_536);
    while (offset < expected.byteLength) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, expected.byteLength - offset), offset);
      if (bytesRead < 1) throw new Error("av_runtime_file_changed");
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
    }
    if ((await handle.read(buffer, 0, 1, offset)).bytesRead !== 0) throw new Error("av_runtime_file_changed");
    const after = await handle.stat({ bigint: true });
    if (hash.digest("hex") !== expected.sha256 || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mode !== after.mode || before.nlink !== after.nlink || before.ctimeNs !== after.ctimeNs || before.mtimeNs !== after.mtimeNs) throw new Error("av_runtime_file_changed");
    signal.throwIfAborted();
  } finally { await handle.close(); }
}

/** Performs actual fixed-path OS/file checks. Not an OCI image pin, application
 * lease or official-signature authentication receipt: those remain outer gates.
 */
export async function verifyReadonlyClamAvRuntime(expectedManifestSha256: string, remainingMs: number, signal: AbortSignal): Promise<VerifiedReadonlyClamAvRuntime> {
  try {
    if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256)) throw new Error("av_runtime_manifest_invalid");
    const bytes = await readBounded(CLAMAV_IMAGE_PATHS.manifest, 65_536, signal);
    if (createHash("sha256").update(bytes).digest("hex") !== expectedManifestSha256) throw new Error("av_runtime_manifest_mismatch");
    const manifest = clamAvRuntimeManifestSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    const cvdPaths = CLAMAV_CVD_NAMES.map(name => `${CLAMAV_IMAGE_PATHS.databaseDirectory}/${name}`);
    const paths = [CLAMAV_IMAGE_PATHS.manifest, CLAMAV_IMAGE_PATHS.nodeExecutable, CLAMAV_IMAGE_PATHS.executable, CLAMAV_IMAGE_PATHS.entrypoint, ...cvdPaths, ...manifest.libraries.map(entry => entry.path)];
    assertReadonlyImageOs({ platform: process.platform, uid: process.getuid?.() ?? -1, gid: process.getgid?.() ?? -1,
      status: (await readBounded("/proc/self/status", 65_536, signal)).toString("utf8"),
      mountinfo: (await readBounded("/proc/self/mountinfo", 65_536, signal)).toString("utf8"),
      network: (await readBounded("/proc/net/dev", 65_536, signal)).toString("utf8"),
    }, paths);
    if (process.versions.node !== manifest.nodeVersion || await realpath(process.execPath) !== CLAMAV_IMAGE_PATHS.nodeExecutable) throw new Error("av_runtime_node_mismatch");
    await verifyFile(CLAMAV_IMAGE_PATHS.nodeExecutable, manifest.nodeExecutable, signal);
    await verifyFile(CLAMAV_IMAGE_PATHS.executable, manifest.executable, signal);
    await verifyFile(CLAMAV_IMAGE_PATHS.entrypoint, manifest.entrypoint, signal);
    for (const entry of manifest.libraries) await verifyFile(entry.path, entry, signal);
    for (const name of CLAMAV_CVD_NAMES) await verifyFile(`${CLAMAV_IMAGE_PATHS.databaseDirectory}/${name}`, manifest.cvds[name], signal);
    const daily = await open(`${CLAMAV_IMAGE_PATHS.databaseDirectory}/daily.cvd`, constants.O_RDONLY | constants.O_NOFOLLOW);
    let header: ReturnType<typeof parseCvdDailyHeader>;
    try { const bytes = Buffer.alloc(512); const read = await daily.read(bytes, 0, 512, 0); header = parseCvdDailyHeader(bytes.subarray(0, read.bytesRead)); }
    finally { await daily.close(); }
    if (header.version !== manifest.cvds["daily.cvd"].version || header.timestampSeconds !== manifest.cvds["daily.cvd"].timestampSeconds) throw new Error("av_runtime_cvd_mismatch");
    assertCvdFreshness(header.timestampSeconds, Date.now(), remainingMs);
    signal.throwIfAborted();
    const freeze = (value: object): void => { Object.freeze(value); for (const nested of Object.values(value)) if (nested && typeof nested === "object") freeze(nested); };
    freeze(manifest);
    const runtime = Object.freeze({ manifest, manifestSha256: expectedManifestSha256 }); verified.add(runtime); return runtime;
  } catch {
    throw new Error(signal.aborted ? "av_runtime_aborted" : "av_runtime_unavailable");
  }
}
