import { fileScanDigest, type BoundScanPorts } from "../../../lib/integration-gateway/file-intake/bound-scan";

/** Disposable HTTP storage transport. Secrets stay in memory, never in URLs or
 * errors. Reads are bounded while streaming, and writes never use upsert. */
export function disposableScanStorage(serviceKey: string, request: typeof fetch = fetch):
  Pick<BoundScanPorts, "readObject" | "putCanonicalIfAbsent"> {
  if (!serviceKey) throw new Error("file_scan_storage_credentials_missing");
  const objectUrl = (bucket: string, key: string) => {
    if (bucket !== "client-uploads" || !/^project-intelligence\/ru\/[a-f0-9/-]+\/(?:quarantine|sources)\/[a-z0-9/.-]+$/.test(key)
      || key.split("/").some(part => part === "." || part === ".." || !part)) throw new Error("file_scan_storage_key_invalid");
    return `http://127.0.0.1:59621/storage/v1/object/${bucket}/${key}`;
  };
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };
  return {
    async readObject(bucket, key, maxBytes) {
      if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100_000_000) throw new Error("file_scan_storage_limit_invalid");
      const response = await request(objectUrl(bucket, key), {
        headers, redirect: "error", signal: AbortSignal.timeout(30_000), cache: "no-store",
      });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error("file_scan_storage_read_failed");
      }
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
        await response.body.cancel(); throw new Error("file_scan_storage_read_limit");
      }
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
      try {
        for (;;) {
          const next = await reader.read(); if (next.done) break;
          total += next.value.byteLength;
          if (total > maxBytes) throw new Error("file_scan_storage_read_limit");
          chunks.push(next.value);
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
      const bytes = new Uint8Array(total); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return bytes;
    },
    async putCanonicalIfAbsent(bucket, key, bytes, mediaType) {
      if (!key.includes("/sources/") || bytes.byteLength < 1 || bytes.byteLength > 100_000_000
        || !key.includes(`/sources/${fileScanDigest(bytes)}/`)) throw new Error("file_scan_canonical_binding_invalid");
      const response = await request(objectUrl(bucket, key), {
        method: "POST", headers: { ...headers, "Content-Type": mediaType, "x-upsert": "false" },
        body: new Blob([new Uint8Array(bytes)]), redirect: "error", signal: AbortSignal.timeout(30_000),
      });
      // Conflict is only permission to attempt exact readback, never proof of bytes.
      // Supabase Storage reports duplicate-object conflicts as HTTP 400 or 409.
      const duplicate = response.status === 409 || response.status === 400;
      await response.body?.cancel();
      if (!response.ok && !duplicate) throw new Error("file_scan_canonical_write_failed");
    },
  };
}
