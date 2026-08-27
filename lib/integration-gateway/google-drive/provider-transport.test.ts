import { describe, expect, it, vi } from "vitest";
import { GoogleDriveProviderTransport, GoogleDriveUserInfoResolver } from "./provider-transport";
import type { ConnectionRef } from "../core/connector";

const connection: ConnectionRef = {
  connectionId: "11111111-1111-4111-8111-111111111111",
  provider: "google_drive",
  organizationId: "22222222-2222-4222-8222-222222222222",
};
const actor = {
  actorId: "33333333-3333-4333-8333-333333333333",
  organizationId: connection.organizationId,
  projectId: "44444444-4444-4444-8444-444444444444",
  correlationId: "55555555-5555-4555-8555-555555555555",
  effectiveCapabilities: ["import_object"],
} as const;
const selected = {
  opaqueKey: "drive-file-1",
  kind: "file" as const,
  displayName: "plan.pdf",
  mimeType: "application/pdf",
  sizeBytes: 9,
  revision: "revision-1",
  modifiedAt: "2026-08-27T00:00:00.000Z",
};

function credentials() {
  return {
    getTokenSet: vi.fn(async () => ({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresInSeconds: 3600,
      tokenType: "Bearer",
      grantedScopes: ["https://www.googleapis.com/auth/drive.file"],
    })),
  };
}

describe("Google Drive provider transport", () => {
  it("downloads only the explicitly selected file after revision/metadata revalidation", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: selected.opaqueKey,
        name: selected.displayName,
        mimeType: selected.mimeType,
        size: String(selected.sizeBytes),
        version: selected.revision,
        modifiedTime: selected.modifiedAt,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("%PDF-1.7\n", { status: 200 }));
    const result = await new GoogleDriveProviderTransport(credentials(), fetchImpl)
      .downloadSelectedObject({
        actor,
        connection,
        projectConnectionId: "66666666-6666-4666-8666-666666666666",
        selected,
      });
    expect(result.bytes.byteLength).toBe(9);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("alt=media");
    expect((fetchImpl.mock.calls[1]?.[1] as RequestInit).headers)
      .toEqual({ Authorization: "Bearer access-token" });
  });

  it("rejects oversized provider metadata before parsing or download", async () => {
    const response = new Response("{}", { status: 200, headers: { "content-length": "70000" } });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    await expect(new GoogleDriveProviderTransport(credentials(), fetchImpl).downloadSelectedObject({
      actor,
      connection,
      projectConnectionId: "66666666-6666-4666-8666-666666666666",
      selected,
    })).rejects.toThrow("google_drive_response_too_large");
  });

  it("hashes the provider subject and never returns it as a connection projection", async () => {
    const resolver = new GoogleDriveUserInfoResolver(vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ sub: "google-subject", name: "Drive Test" }), { status: 200 }),
    ));
    const result = await resolver.resolve({ accessToken: "access-token" });
    expect(result.displayLabel).toBe("Drive Test");
    expect(result.externalSubjectHashHex).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.externalSubjectHashHex).not.toContain("google-subject");
  });

  it("maps expired credentials and provider 401 to reauth_required", async () => {
    await expect(new GoogleDriveProviderTransport({
      getTokenSet: vi.fn(async () => null),
    }).health(connection)).resolves.toMatchObject({ status: "reauth_required" });
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status: 401 }));
    await expect(new GoogleDriveProviderTransport(credentials(), fetchImpl).listObjects({
      actor,
      connection,
    })).rejects.toThrow("reauth_required");
  });
});
