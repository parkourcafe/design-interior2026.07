import { describe, expect, it } from "vitest";
import { accountConsentDestination, accountConsentNext, accountConsentProtected } from "@/lib/legal/account-consent";

describe("account consent HTTP boundary", () => {
  it.each(["/dashboard", "/dashboard/setup", "/api/projectceo/commands", "/api/dashboard/contracts", "/api/layout-studio/123", "/api/brief/custom-question/structure", "/api/projects/123/links", "/api/integrations/google-drive/oauth/callback"])("protects human surface %s", (path) => {
    expect(accountConsentProtected(path)).toBe(true);
  });
  it.each(["/api/integrations/telegram/webhook", "/api/integrations/google-drive/webhook", "/api/auth/register", "/api/auth/consent", "/auth/reset-password", "/api/account/delete", "/api/intake/submit", "/api/project-room/task-status", "/api/proposal/respond", "/api/client/create", "/api/pilot", "/api/health", "/dashboard-other"])("preserves independent boundary %s", (path) => {
    expect(accountConsentProtected(path, "POST")).toBe(false);
  });
  it("protects invitation mutations while keeping public preview", () => {
    expect(accountConsentProtected("/join/token", "GET")).toBe(false);
    expect(accountConsentProtected("/join/token", "POST")).toBe(true);
  });
  it.each(["https://evil.invalid", "//evil.invalid", "/\\evil.invalid", "/auth/consent?next=/dashboard", null])("rejects unsafe or recursive destination %s", (next) => {
    expect(accountConsentNext(next)).toBe("/dashboard");
  });
  it("preserves internal invitation paths", () => {
    expect(accountConsentDestination("/join/token")).toBe("/auth/consent?next=%2Fjoin%2Ftoken");
  });
});
