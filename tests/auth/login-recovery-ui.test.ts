import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const login = readFileSync(resolve(process.cwd(), "app/login/page.tsx"), "utf8");
const reset = readFileSync(resolve(process.cwd(), "app/auth/reset-password/page.tsx"), "utf8");

describe("authentication recovery UI", () => {
  it("exposes password recovery and preserves the callback destination", () => {
    expect(login).toContain("resetPasswordForEmail");
    expect(login).toContain('authCallbackUrl("/auth/reset-password")');
    expect(login).toContain("forgotPassword");
    expect(login).toContain("invalidCredentials");
  });

  it("updates the password after the recovery callback", () => {
    expect(reset).toContain("updateUser({ password })");
    expect(reset).toContain("passwordMismatch");
  });
});
