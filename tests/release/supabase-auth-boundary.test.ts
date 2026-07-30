import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

describe("Supabase SSR authentication boundary", () => {
  it("validates signed claims before admitting dashboard requests", () => {
    const proxy = source("proxy.ts");

    expect(proxy).toContain("supabase.auth.getClaims()");
    expect(proxy).not.toContain("supabase.auth.getSession()");
    expect(proxy).toContain('request.nextUrl.pathname.startsWith("/dashboard")');
    expect(proxy).toContain('url.pathname = "/login"');
  });

  it("propagates refreshed cookies and anti-cache headers", () => {
    const proxy = source("proxy.ts");

    expect(proxy).toContain("request.cookies.set(name, value)");
    expect(proxy).toContain("response.cookies.set(name, value, options)");
    expect(proxy).toContain("response.headers.set(name, value)");
  });

  it("prefers the modern publishable key and keeps the legacy fallback", () => {
    for (const path of [
      "proxy.ts",
      "lib/supabase/server.ts",
      "lib/supabase/browser.ts",
    ]) {
      const file = source(path);
      expect(file).toContain("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
      expect(file).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    }
  });

  it("does not use service role for signup or password changes", () => {
    for (const path of [
      "app/api/auth/register/route.ts",
      "app/api/auth/set-password/route.ts",
    ]) {
      const file = source(path);
      expect(file).not.toContain("createAdminClient");
      expect(file).not.toContain("auth.admin");
    }

    expect(source("app/api/auth/register/route.ts")).toContain("auth.signUp");
    expect(source("app/api/auth/set-password/route.ts")).toContain("auth.updateUser");
  });
});
