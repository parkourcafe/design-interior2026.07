import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ enabled: true, rpc: vi.fn(), claims: vi.fn(), create: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: state.create }));
vi.mock("@/lib/legal/consent-policy", () => ({ consentEnabled: () => state.enabled }));
import { proxy } from "@/proxy";
beforeEach(() => {
  vi.clearAllMocks(); state.enabled = true;
  state.rpc.mockResolvedValue({ data: true, error: null });
  state.claims.mockResolvedValue({ data: { claims: { sub: "verified" } }, error: null });
  state.create.mockReturnValue({ auth: { getClaims: state.claims }, rpc: state.rpc });
});
function req(path: string, method = "GET") { return new NextRequest(`https://app.invalid${path}`, { method }); }
describe("account consent proxy execution", () => {
  it("does not inspect public token or webhook requests", async () => {
    expect((await proxy(req("/api/intake/submit", "POST"))).status).toBe(200);
    expect((await proxy(req("/api/integrations/telegram/webhook", "POST"))).status).toBe(200);
    expect(state.create).not.toHaveBeenCalled();
  });
  it("preserves flag-off API behavior", async () => {
    state.enabled = false;
    expect((await proxy(req("/api/projectceo/commands", "POST"))).status).toBe(200);
    expect(state.create).not.toHaveBeenCalled();
  });
  it("denies API mutation without current acceptance", async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    expect((await proxy(req("/api/projectceo/commands", "POST"))).status).toBe(403);
  });
  it("redirects dashboard to explicit acceptance", async () => {
    state.rpc.mockResolvedValue({ data: false, error: null });
    const response = await proxy(req("/dashboard/projects"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/auth/consent?next=");
  });
  it("fails closed on database errors", async () => {
    state.rpc.mockResolvedValue({ data: true, error: { message: "unavailable" } });
    expect((await proxy(req("/api/projects/id/links", "POST"))).status).toBe(503);
  });
  it("does not treat unauthenticated requests as accepted", async () => {
    state.claims.mockResolvedValue({ data: null, error: null });
    expect((await proxy(req("/api/projectceo/portfolio"))).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it("admits current acceptance", async () => {
    expect((await proxy(req("/api/projectceo/portfolio"))).status).toBe(200);
  });
});
