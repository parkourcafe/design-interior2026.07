import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ enabled: true, has: vi.fn(), document: vi.fn(), receipt: vi.fn(), record: vi.fn(), withdraw: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/legal/consent-policy", async (original) => ({ ...await original<typeof import("@/lib/legal/consent-policy")>(), consentEnabled: () => mocks.enabled }));
vi.mock("@/lib/legal/consent-server", async (original) => ({ ...await original<typeof import("@/lib/legal/consent-server")>(), ensureBrowserConsentProof: vi.fn(), hasBrowserConsent: mocks.has, readConsentDocument: mocks.document, readBrowserConsentReceipt: mocks.receipt, recordBrowserConsent: mocks.record, withdrawBrowserConsent: mocks.withdraw }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => true, clientIp: () => "test" }));
import { enforceIntakeConsent, intakeTokenMatches } from "@/lib/legal/intake-consent";
import { POST } from "@/app/api/intake/consent/route";
const id = "11111111-1111-4111-8111-111111111111";
function request(body: unknown = {}, origin = "https://app.invalid", token = "token-a") { return new Request("https://app.invalid/api/intake/consent", { method: "POST", headers: { origin, "x-intake-token": token }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = true; mocks.has.mockResolvedValue(true); mocks.document.mockResolvedValue({ id }); mocks.receipt.mockResolvedValue(null); mocks.record.mockResolvedValue({ receiptId: id }); });
describe("intake consent enforcement", () => {
  it("preserves disabled behavior without querying receipts", async () => { mocks.enabled = false; expect(await enforceIntakeConsent(request({}, "external"))).toBeNull(); expect(mocks.has).not.toHaveBeenCalled(); });
  it("rejects origin/header before checking receipts", async () => { expect((await enforceIntakeConsent(request({}, "https://evil.invalid")))?.status).toBe(403); expect((await enforceIntakeConsent(request({}, "https://app.invalid", "")))?.status).toBe(403); expect(mocks.has).not.toHaveBeenCalled(); });
  it("checks exact header scope and blocks body substitution", async () => { expect(await enforceIntakeConsent(request())).toBeNull(); expect(mocks.has).toHaveBeenCalledWith({}, "intake", "token-a"); expect(intakeTokenMatches(request(), "token-b")).toBe(false); });
  it("blocks absent or unavailable consent", async () => { mocks.has.mockResolvedValue(false); expect((await enforceIntakeConsent(request()))?.status).toBe(403); mocks.has.mockRejectedValue(new Error("private detail")); const res = await enforceIntakeConsent(request()); expect(res?.status).toBe(503); expect(await res?.text()).not.toContain("private detail"); });
});
describe("intake consent API", () => {
  it.each([false, "true", 1, null])("rejects non-literal consent %s", async accepted => { expect((await POST(request({ action: "accept", token: "t", documentId: id, requestId: id, accepted }))).status).toBe(400); expect(mocks.record).not.toHaveBeenCalled(); });
  it("rejects document substitution", async () => { expect((await POST(request({ action: "accept", token: "t", documentId: "22222222-2222-4222-8222-222222222222", requestId: id, accepted: true }))).status).toBe(409); });
  it("keeps withdrawal available when disabled", async () => { mocks.enabled = false; expect((await POST(request({ action: "withdraw", token: "t", receiptId: id }))).status).toBe(200); expect(mocks.withdraw).toHaveBeenCalledWith({}, "intake", "t", id); expect(mocks.document).not.toHaveBeenCalled(); });
  it("returns prior receipt for withdrawal without an active document", async () => { mocks.document.mockResolvedValue(null); mocks.receipt.mockResolvedValue({ receiptId: id }); const result = await (await POST(request({ action: "status", token: "t" }))).json(); expect(result).toMatchObject({ enabled: true, document: null, accepted: false, receipt: { receiptId: id } }); expect(mocks.has).not.toHaveBeenCalled(); });
  it("does not accept with no approved document", async () => { mocks.document.mockResolvedValue(null); expect((await POST(request({ action: "accept", token: "t", documentId: id, requestId: id, accepted: true }))).status).toBe(503); expect(mocks.record).not.toHaveBeenCalled(); });
});

it("discovers an existing browser receipt even when enforcement is disabled", async () => {
  mocks.enabled = false; mocks.receipt.mockResolvedValue({ receiptId: id });
  expect(await (await POST(request({ action: "receipt", token: "t" }))).json()).toEqual({ receipt: { receiptId: id } });
  expect(mocks.receipt).toHaveBeenCalledWith({}, "intake", "t");
  expect(mocks.document).not.toHaveBeenCalled();
});
