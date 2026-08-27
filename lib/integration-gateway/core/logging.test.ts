import { describe, expect, it } from "vitest";
import { sanitizeIntegrationLogMetadata } from "./logging";

describe("integration log boundary", () => {
  it("keeps only the approved structured fields", () => {
    expect(sanitizeIntegrationLogMetadata({
      provider_code: "google_drive",
      organization_id: "org-id",
      arbitrary: "not emitted",
    })).toEqual({
      provider_code: "google_drive",
      organization_id: "org-id",
    });
  });

  it("rejects secret, token, provider-body and signed-url fields", () => {
    for (const field of ["access_token", "refreshToken", "raw_filename", "webhook_body", "signed_url"]) {
      expect(() => sanitizeIntegrationLogMetadata({ [field]: "blocked" })).toThrow(
        "forbidden_log_field",
      );
    }
  });
});
