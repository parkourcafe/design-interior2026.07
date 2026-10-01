import { describe, expect, it } from "vitest";
import { extendedPublicLinkExpiry, isPublicLinkActive } from "./public-link";

const now = new Date("2026-10-01T12:00:00Z");

describe("client proposal link expiry", () => {
  it("is active before the expiry and closed at or after it", () => {
    expect(isPublicLinkActive("2026-10-02T00:00:00Z", now)).toBe(true);
    expect(isPublicLinkActive("2026-10-01T12:00:00Z", now)).toBe(false);
    expect(isPublicLinkActive("2026-09-01T00:00:00Z", now)).toBe(false);
  });
  it("treats an unparsable value as closed and a missing one as not yet limited", () => {
    expect(isPublicLinkActive("not-a-date", now)).toBe(false);
    expect(isPublicLinkActive(null, now)).toBe(true);
  });
  it("extends by 90 days from now", () => {
    expect(extendedPublicLinkExpiry(now)).toBe("2026-12-30T12:00:00.000Z");
  });
});
