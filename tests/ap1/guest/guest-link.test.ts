import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  type GuestReleaseRpcClient,
  ProjectCeoGuestLinkError,
  readProjectCeoGuestRelease,
} from "../../../lib/project-intelligence/delivery/projectceo/guest-link";

describe("ProjectCEO guest-link helper", () => {
  it("hashes only canonical guest tokens, returns the sanitized envelope projection, and rejects invalid tokens without disclosure or RPC calls", async () => {
    const calls: Array<{
      schema: string;
      functionName: string;
      args: { token_digest: string };
    }> = [];

    const projection = {
      allowAcknowledgement: true,
      expiresAt: "2026-08-01T12:00:00.000Z",
      package: {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "project_root" as const,
        name: "Основной пакет проекта",
        stableKey: "project-root",
      },
      projectId: "22222222-2222-4222-8222-222222222222",
      release: {
        graphDigest:
          "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publishedAt: "2026-07-18T09:30:00.000Z",
        versionId: "release-version-7",
        versionNo: 7,
      },
    };
    const envelope = {
      contractVersion: "project-ceo-foundation/0.1",
      requestId: "guest-release-request-1",
      data: projection,
      error: null,
    };

    const client: GuestReleaseRpcClient = {
      schema(name) {
        return {
          rpc(functionName, args) {
            calls.push({ schema: name, functionName, args });
            return Promise.resolve({ data: envelope, error: null });
          },
        };
      },
    };

    // Canonical unpadded base64url encoding of bytes 0x00 through 0x1f.
    const validToken = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

    await expect(readProjectCeoGuestRelease(validToken, client)).resolves.toEqual(
      projection,
    );
    expect(calls).toEqual([
      {
        schema: "projectceo_api",
        functionName: "read_guest_release",
        args: {
          token_digest:
            "\\x630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd",
        },
      },
    ]);

    const invalidTokens = [
      validToken.slice(0, -1),
      `${validToken.slice(0, -1)}+`,
      `${validToken.slice(0, -1)}9`,
    ];

    for (const invalidToken of invalidTokens) {
      const callsBefore = calls.length;
      let caught: unknown;

      try {
        await readProjectCeoGuestRelease(invalidToken, client);
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeDefined();
      expect(caught).toBeInstanceOf(ProjectCeoGuestLinkError);
      expect(caught).toMatchObject({ code: "invalid_token" });
      let serializedError = "";
      try {
        serializedError = JSON.stringify(caught) ?? "";
      } catch {
        serializedError = "";
      }
      expect(`${String(caught)} ${serializedError}`).not.toContain(invalidToken);
      expect(calls).toHaveLength(callsBefore);
    }
  });

  it("sanitizes successful guest-release envelopes and maps backend failures to non-leaking controlled errors", async () => {
    const rawToken = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";
    const expectedProjection = {
      allowAcknowledgement: false,
      expiresAt: "2026-08-01T12:00:00.000Z",
      package: {
        id: "11111111-1111-4111-8111-111111111111",
        kind: "work_package" as const,
        name: "Рабочий пакет",
        stableKey: "work-package-01",
      },
      projectId: "22222222-2222-4222-8222-222222222222",
      release: {
        graphDigest:
          "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        publishedAt: "2026-07-18T09:30:00.000Z",
        versionId: "release-version-7",
        versionNo: 7,
      },
    };

    const clientFor = (rpcResult: {
      data: unknown;
      error: unknown;
    }): GuestReleaseRpcClient => ({
      schema() {
        return {
          rpc() {
            return Promise.resolve(rpcResult);
          },
        };
      },
    });

    const successfulEnvelope = {
      contractVersion: "project-ceo-foundation/0.1",
      requestId: "guest-release-request-1",
      organizationId: "envelope-organization-secret",
      filename: "envelope-private-file.pdf",
      signedUrl: "https://private.example/envelope-signed-url",
      privateMarker: "envelope-private-marker",
      data: {
        ...expectedProjection,
        organizationId: "data-organization-secret",
        filename: "data-private-file.pdf",
        signedUrl: "https://private.example/data-signed-url",
        privateMarker: "data-private-marker",
        package: {
          ...expectedProjection.package,
          organizationId: "package-organization-secret",
          filename: "package-private-file.pdf",
          signedUrl: "https://private.example/package-signed-url",
          privateMarker: "package-private-marker",
        },
        release: {
          ...expectedProjection.release,
          organizationId: "release-organization-secret",
          filename: "release-private-file.pdf",
          signedUrl: "https://private.example/release-signed-url",
          privateMarker: "release-private-marker",
        },
      },
      error: null,
    };

    await expect(
      readProjectCeoGuestRelease(
        rawToken,
        clientFor({ data: successfulEnvelope, error: null }),
      ),
    ).resolves.toStrictEqual(expectedProjection);

    const errorCases: Array<{
      rpcResult: { data: unknown; error: unknown };
      expectedCode: ProjectCeoGuestLinkError["code"];
      secrets: string[];
    }> = [
      {
        rpcResult: {
          data: null,
          error: {
            code: "P1106",
            message: "revoked-backend-message",
            details: "revoked-backend-details",
            hint: "revoked-backend-hint",
          },
        },
        expectedCode: "revoked",
        secrets: [
          "revoked-backend-message",
          "revoked-backend-details",
          "revoked-backend-hint",
        ],
      },
      {
        rpcResult: {
          data: null,
          error: {
            code: "P1105",
            message: "expired-backend-message",
            details: "expired-backend-details",
            hint: "expired-backend-hint",
          },
        },
        expectedCode: "expired",
        secrets: [
          "expired-backend-message",
          "expired-backend-details",
          "expired-backend-hint",
        ],
      },
      {
        rpcResult: {
          data: null,
          error: {
            code: "P1104",
            message: "missing-backend-message",
            details: "missing-backend-details",
            hint: "missing-backend-hint",
          },
        },
        expectedCode: "not_found",
        secrets: [
          "missing-backend-message",
          "missing-backend-details",
          "missing-backend-hint",
        ],
      },
      ...["P1103", "42501"].map((code, index) => ({
        rpcResult: {
          data: null,
          error: {
            code,
            message: `forbidden-backend-message-${index}`,
            details: `forbidden-backend-details-${index}`,
            hint: `forbidden-backend-hint-${index}`,
          },
        },
        expectedCode: "forbidden" as const,
        secrets: [
          `forbidden-backend-message-${index}`,
          `forbidden-backend-details-${index}`,
          `forbidden-backend-hint-${index}`,
        ],
      })),
      {
        rpcResult: {
          data: null,
          error: {
            code: "XX999",
            message: "unknown-backend-message",
            details: "unknown-backend-details",
            hint: "unknown-backend-hint",
          },
        },
        expectedCode: "internal_error",
        secrets: [
          "unknown-backend-message",
          "unknown-backend-details",
          "unknown-backend-hint",
        ],
      },
      {
        rpcResult: {
          data: {
            contractVersion: "project-ceo-foundation/0.1",
            requestId: "malformed-request",
            data: {
              allowAcknowledgement: true,
              privateMarker: "malformed-private-marker",
            },
            error: null,
            message: "malformed-backend-message",
            details: "malformed-backend-details",
            hint: "malformed-backend-hint",
          },
          error: null,
        },
        expectedCode: "internal_error",
        secrets: [
          "malformed-private-marker",
          "malformed-backend-message",
          "malformed-backend-details",
          "malformed-backend-hint",
        ],
      },
      {
        rpcResult: {
          data: {
            contractVersion: "project-ceo-foundation/0.1",
            requestId: "invalid-scope-shape",
            data: {
              ...expectedProjection,
              package: {
                ...expectedProjection.package,
                kind: "organization_wide",
              },
            },
            error: null,
          },
          error: null,
        },
        expectedCode: "internal_error",
        secrets: ["organization_wide"],
      },
    ];

    for (const { rpcResult, expectedCode, secrets } of errorCases) {
      let caught: unknown;

      try {
        await readProjectCeoGuestRelease(rawToken, clientFor(rpcResult));
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ProjectCeoGuestLinkError);
      if (!(caught instanceof ProjectCeoGuestLinkError)) {
        throw new Error("Expected a controlled ProjectCEO guest-link error");
      }

      expect(caught.code).toBe(expectedCode);
      const stringForm = String(caught);
      const jsonForm = JSON.stringify(caught);
      expect(stringForm).not.toContain(rawToken);
      expect(jsonForm).not.toContain(rawToken);

      for (const secret of secrets) {
        expect(stringForm).not.toContain(secret);
        expect(jsonForm).not.toContain(secret);
      }
    }
  });
});
