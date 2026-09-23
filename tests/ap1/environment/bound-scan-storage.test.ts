import { describe, expect, it, vi } from "vitest";
import { disposableScanStorage } from "./bound-scan-storage";
import { fileScanDigest } from "../../../lib/integration-gateway/file-intake/bound-scan";

const bytes = new Uint8Array([1, 2, 3]);
const key = `project-intelligence/ru/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/sources/${fileScanDigest(bytes)}/document.pdf`;
describe("disposable scan HTTP storage", () => {
  it("reads only loopback with bounded bytes and nonredirecting in-memory credentials", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(bytes));
    const storage = disposableScanStorage("synthetic-test-only", request);
    expect(await storage.readObject("client-uploads", key, 3)).toEqual(bytes);
    expect(request.mock.calls[0]?.[0]).toBe(`http://127.0.0.1:59621/storage/v1/object/client-uploads/${key}`);
    expect(request.mock.calls[0]?.[1]).toMatchObject({ redirect: "error", cache: "no-store" });
  });
  it("rejects oversized content length", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(bytes, { headers: { "Content-Length": "4" } }));
    await expect(disposableScanStorage("synthetic", request).readObject("client-uploads", key, 3)).rejects.toThrow("file_scan_storage_read_limit");
  });
  it("bounds chunked streams even without content length", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.enqueue(bytes); c.close(); } })));
    await expect(disposableScanStorage("synthetic", request).readObject("client-uploads", key, 3)).rejects.toThrow("file_scan_storage_read_limit");
  });
  it("rejects traversal before contacting storage", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(disposableScanStorage("synthetic", request).readObject("client-uploads", `${key}/../x`, 3)).rejects.toThrow("file_scan_storage_key_invalid");
    expect(request).not.toHaveBeenCalled();
  });
  it("never upserts canonical bytes and rejects a wrong content-addressed key", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 409 }));
    const storage = disposableScanStorage("synthetic", request);
    await storage.putCanonicalIfAbsent("client-uploads", key, bytes, "application/pdf");
    expect(request.mock.calls[0]?.[1]).toMatchObject({ method: "POST", headers: { "x-upsert": "false" } });
    await expect(storage.putCanonicalIfAbsent("client-uploads", key, new Uint8Array([9]), "application/pdf")).rejects.toThrow("file_scan_canonical_binding_invalid");
  });
});
