// Сайт за прокси (Caddy на своём сервере): request.url указывает на внутренний
// адрес контейнера, поэтому переходы после входа строятся от публичного адреса
// из заголовков прокси. Регрессия: Location вёл на https://0.0.0.0:3000/...
import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      exchangeCodeForSession: async () => ({ error: { message: "bad code" } }),
      verifyOtp: async () => ({ error: null }),
    },
  }),
}));

const { GET } = await import("@/app/auth/callback/route");

function behindProxy(path: string) {
  return new NextRequest(`https://0.0.0.0:3000${path}`, {
    headers: { "x-forwarded-host": "www.remhaos.com", "x-forwarded-proto": "https" },
  });
}

describe("auth callback behind a reverse proxy", () => {
  it("redirects to the public origin, not the container address", async () => {
    const ok = await GET(behindProxy("/auth/callback?token_hash=abc&type=email&next=/dashboard/setup"));
    expect(ok.headers.get("location")).toBe("https://www.remhaos.com/dashboard/setup");
    const failed = await GET(behindProxy("/auth/callback?code=bad"));
    expect(failed.headers.get("location")).toMatch(/^https:\/\/www\.remhaos\.com\/login\?error=/);
    const empty = await GET(behindProxy("/auth/callback"));
    expect(empty.headers.get("location")).toBe("https://www.remhaos.com/login?error=no_auth_params");
  });

  it("keeps the request origin when there is no proxy", async () => {
    const direct = await GET(new NextRequest("http://localhost:3000/auth/callback"));
    expect(direct.headers.get("location")).toBe("http://localhost:3000/login?error=no_auth_params");
  });
});
