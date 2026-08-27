import { describe, expect, it } from "vitest";
import {
  normalizeProjectLinkUrl,
  ProjectLinkUrlPolicyError,
} from "./url-policy";

describe("project link URL policy", () => {
  it("normalizes fragments without making a network request", () => {
    expect(normalizeProjectLinkUrl("https://example.com/catalog#room")).toEqual({
      normalizedUrl: "https://example.com/catalog",
      domain: "example.com",
    });
  });

  it.each([
    "javascript:alert(1)",
    "file:///tmp/design.pdf",
    "ftp://example.com/file",
    "https://user:pass@example.com/private",
    "http://localhost:3000/admin",
    "http://127.0.0.1/admin",
    "http://2130706433/admin",
    "https://example.com/?token=secret",
  ])("rejects unsafe URL %s", (value) => {
    expect(() => normalizeProjectLinkUrl(value)).toThrow(ProjectLinkUrlPolicyError);
  });

  it("keeps ordinary query parameters", () => {
    expect(normalizeProjectLinkUrl("https://example.com/search?q=stone&view=grid").normalizedUrl)
      .toBe("https://example.com/search?q=stone&view=grid");
  });
});
