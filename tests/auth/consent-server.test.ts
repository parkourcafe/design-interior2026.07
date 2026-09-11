import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => store }));
import { ensureBrowserConsentProof, hasBrowserConsent, readConsentDocument, readBrowserConsentReceipt, recordBrowserConsent, withdrawBrowserConsent } from "@/lib/legal/consent-server";
const proof = "a".repeat(64);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const id = "11111111-1111-4111-8111-111111111111";
const receipt = { receiptId: id, acceptedAt: "2026-09-11T00:00:00+00:00", expiresAt: "2026-09-12T00:00:00+00:00" };
const client = { rpc: vi.fn() };
beforeEach(() => { vi.clearAllMocks(); store.get.mockReturnValue({ value: proof }); client.rpc.mockResolvedValue({ data: receipt, error: null }); });
describe("consent server proof", () => {
  it("requires browser possession and does not query DB without it", async () => { store.get.mockReturnValue(undefined); expect(await hasBrowserConsent(client, "intake", "t")).toBe(false); expect(client.rpc).not.toHaveBeenCalled(); });
  it("requires strict boolean RPC evidence", async () => { client.rpc.mockResolvedValue({ data: "true", error: null }); await expect(hasBrowserConsent(client, "intake", "t")).rejects.toThrow("consent_unavailable"); });
  it("sends only proof hash and binds the cookie to purpose and token", async () => { const result = await recordBrowserConsent(client, "intake", "t", { accepted: true, documentId: id, requestId: id }); expect(result).toEqual(receipt); expect(client.rpc).toHaveBeenCalledWith("record_browser_consent", expect.objectContaining({ p_browser_hash: digest(proof), p_token: "t", p_purpose: "intake" })); expect(store.set).toHaveBeenCalledWith(`remhaos_consent_intake_${digest("t").slice(0,20)}`, proof, expect.objectContaining({ httpOnly: true, sameSite: "strict", path: "/" })); expect(JSON.stringify(result)).not.toContain(proof); });
  it("does not install a proof cookie when storage fails", async () => { client.rpc.mockResolvedValue({ data: receipt, error: { message: "private" } }); await expect(recordBrowserConsent(client, "intake", "t", { accepted: true, documentId: id, requestId: id })).rejects.toThrow("consent_unavailable"); expect(store.set).not.toHaveBeenCalled(); });
  it("withdraws with original proof and scoped receipt", async () => { await withdrawBrowserConsent(client, "intake", "old-token", id); expect(client.rpc).toHaveBeenCalledWith("withdraw_browser_consent", { p_purpose: "intake", p_token: "old-token", p_browser_hash: digest(proof), p_receipt_id: id }); });
  it("can recover receipt without reading current document", async () => { expect(await readBrowserConsentReceipt(client, "intake", "t")).toEqual(receipt); expect(client.rpc).toHaveBeenCalledWith("get_browser_consent_receipt", expect.objectContaining({ p_token: "t", p_browser_hash: digest(proof) })); });
  it("rejects wrong-purpose or malformed documents", async () => { client.rpc.mockResolvedValue({ data: { id, purpose: "account", version: "v1", sha256: "b".repeat(64), body: "text", operator: "fixture" }, error: null }); await expect(readConsentDocument(client, "intake")).rejects.toThrow("consent_unavailable"); });
});

it("requires a previously delivered browser proof before inserting any receipt", async () => {
  store.get.mockReturnValue(undefined);
  await expect(recordBrowserConsent(client, "intake", "t", { accepted: true, documentId: id, requestId: id })).rejects.toThrow("consent_unavailable");
  expect(client.rpc).not.toHaveBeenCalled();
  await ensureBrowserConsentProof("intake", "t");
  expect(store.set).toHaveBeenCalledWith(expect.any(String), expect.stringMatching(/^[a-f0-9]{64}$/), expect.objectContaining({ httpOnly: true }));
});
it("preserves the proof and request identity after a lost database response", async () => {
  client.rpc.mockRejectedValueOnce(new Error("response lost after commit")).mockResolvedValueOnce({ data: receipt, error: null });
  const input = { accepted: true as const, documentId: id, requestId: id };
  await expect(recordBrowserConsent(client, "intake", "t", input)).rejects.toThrow();
  expect(await recordBrowserConsent(client, "intake", "t", input)).toEqual(receipt);
  expect(client.rpc.mock.calls[0]).toEqual(client.rpc.mock.calls[1]);
});
