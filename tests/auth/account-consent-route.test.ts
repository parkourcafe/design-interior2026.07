import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enabled: false, origin: true,
  browserReceipt: vi.fn(), withdrawBrowser: vi.fn(), document: vi.fn(), record: vi.fn(), rpc: vi.fn(), getUser: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.getUser } }) }));
vi.mock("@/lib/legal/consent-policy", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/legal/consent-policy")>(), consentEnabled: () => mocks.enabled,
}));
vi.mock("@/lib/legal/consent-server", () => ({ readBrowserConsentReceipt: mocks.browserReceipt, withdrawBrowserConsent: mocks.withdrawBrowser, ensureBrowserConsentProof: vi.fn(), readConsentDocument: mocks.document, recordBrowserConsent: mocks.record, sameOrigin: () => mocks.origin }));
import { GET, POST, DELETE } from "@/app/api/auth/consent/route";
const id = "11111111-1111-4111-8111-111111111111";
const body = { action: "account", accepted: true, documentId: id, requestId: "22222222-2222-4222-8222-222222222222" };
function request(value: unknown = body) { return new Request("https://app.invalid/api/auth/consent", { method: "POST", body: JSON.stringify(value) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = true; mocks.origin = true; mocks.document.mockResolvedValue({ id }); mocks.rpc.mockResolvedValue({ data: { receiptId: id, acceptedAt: "2026-09-11T00:00:00Z", expiresAt: null }, error: null }); mocks.getUser.mockResolvedValue({ data: { user: { id: "verified" } }, error: null }); });

describe("account consent route", () => {
  it("withdraws anonymous receipt using browser proof without an account", async () => {
    mocks.enabled = false;
    expect((await DELETE(request({ action: "preauth", receiptId: id }))).status).toBe(200);
    expect(mocks.withdrawBrowser).toHaveBeenCalledWith(expect.anything(), "account", "", id);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("fails closed on malformed success from account acceptance", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect((await POST(request())).status).toBe(503);
  });
  it("looks up caller-owned receipt after document activation is disabled", async () => {
    mocks.enabled = false;
    mocks.rpc.mockResolvedValue({ data: { receiptId: id, expiresAt: null }, error: null });
    const result = await GET(new Request("https://app.invalid/api/auth/consent?receipt=1"));
    expect(result.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("get_my_consent_receipt");
    expect(mocks.document).not.toHaveBeenCalled();
  });
  it("allows authenticated withdrawal after activation is disabled", async () => {
    mocks.enabled = false;
    expect((await DELETE(request({ receiptId: id }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("withdraw_my_consent", { p_receipt_id: id });
    expect(mocks.document).not.toHaveBeenCalled();
  });
  it("does not touch the DB while disabled", async () => {
    mocks.enabled = false;
    expect(await (await GET()).json()).toEqual({ enabled: false });
    expect(await (await POST(request())).json()).toEqual({ enabled: false });
    expect(mocks.document).not.toHaveBeenCalled();
  });
  it("rejects cross-origin acceptance", async () => {
    mocks.origin = false;
    expect((await POST(request())).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("requires explicit true", async () => {
    expect((await POST(request({ ...body, accepted: false }))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("fails closed with no approved document", async () => {
    mocks.document.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects superseded documents", async () => {
    mocks.document.mockResolvedValue({ id: "different" });
    expect((await POST(request())).status).toBe(409);
  });
  it("does not attribute anonymous preauth receipt to an account", async () => {
    expect((await POST(request({ ...body, action: "preauth" }))).status).toBe(200);
    expect(mocks.record).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("requires verified user and derives actor exclusively inside RPC", async () => {
    expect((await POST(request({ ...body, userId: "attacker" }))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("accept_my_consent", { p_document_id: id, p_accepted: true, p_request_id: body.requestId });
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it("rejects missing user", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await POST(request())).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("does not succeed on storage errors", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "unavailable" } });
    expect((await POST(request())).status).toBe(503);
  });
});
