import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../app/api/health/route";

const configurationKeys = [
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY", "YC_FOLDER_ID", "YC_API_KEY",
  "GIGACHAT_AUTH_KEY", "ZAI_API_KEY",
] as const;

describe("release health route", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    vi.stubEnv("LLM_PROVIDER", undefined);
    for (const key of configurationKeys) vi.stubEnv(key, undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns the deployed commit when configured", async () => {
    const commit = "1234567890abcdef1234567890abcdef12345678";
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", commit);
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", commit });
  });

  it("returns null without commit metadata and reports unconfigured systems", async () => {
    const body = await GET().json();
    expect(body).toMatchObject({
      status: "ok", commit: null,
      env: { supabase: false, supabase_service_role: false,
        llm_provider: "yandex", llm_configured: false },
    });
    expect(Number.isNaN(Date.parse(body.ts))).toBe(false);
  });

  it.each(["yandex", "gigachat", "zai"])(
    "reports %s configuration without exposing synthetic credentials",
    async (provider) => {
      vi.stubEnv("LLM_PROVIDER", provider);
      for (const key of configurationKeys) vi.stubEnv(key, `synthetic-test-only-${key}`);
      const body = await GET().json();
      expect(body.env).toEqual({ supabase: true, supabase_service_role: true,
        llm_provider: provider, llm_configured: true });
      const serialized = JSON.stringify(body);
      for (const key of configurationKeys) {
        expect(serialized).not.toContain(`synthetic-test-only-${key}`);
      }
    },
  );
});
