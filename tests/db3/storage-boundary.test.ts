import { describe, expect, it } from "vitest";
import type {
  PostgresRpcClient,
  SourceUploadAuthorization,
} from "../../lib/project-intelligence/adapters/postgres";
import { FoundationPostgresAdapter } from "../../lib/project-intelligence/adapters/postgres";
import {
  ProjectSourceStorageAdapter,
  deriveOpaqueToken,
  digestOpaqueToken,
  validateSourceFile,
  type PrivateStorageClient,
} from "../../lib/project-intelligence/adapters/storage";
import { FoundationDeliveryService } from "../../lib/project-intelligence/delivery/server";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

describe("token and source storage boundary", () => {
  it("derives replay-stable 256-bit tokens while exposing only digest to SQL", () => {
    const input = {
      secret: "a".repeat(32),
      namespace: "invitation" as const,
      scope: `${UUID_A}/project`,
      idempotencyKey: "invite-project-architect-1",
    };
    const first = deriveOpaqueToken(input);
    const replay = deriveOpaqueToken(input);

    expect(first).toEqual(replay);
    expect(Buffer.from(first.rawToken, "base64url")).toHaveLength(32);
    expect(first.tokenDigest).toBe(digestOpaqueToken(first.rawToken));
    expect(first.tokenDigest).not.toContain(first.rawToken);
    expect(
      deriveOpaqueToken({ ...input, scope: `${UUID_B}/project` }).rawToken,
    ).not.toBe(first.rawToken);
  });

  it("rejects raw CAD/archive and mismatched MIME before storage", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(() =>
      validateSourceFile({
        bytes,
        extension: "dwg",
        mediaType: "application/acad",
        sourceRole: "drawing-preview",
      }),
    ).toThrow("project_ceo.unsupported_source");
    expect(() =>
      validateSourceFile({
        bytes,
        extension: "pdf",
        mediaType: "image/png",
        sourceRole: "document",
      }),
    ).toThrow("project_ceo.invalid_source_file");
  });

  it("uploads only the exact canonical authorized key with upsert disabled", async () => {
    const calls: unknown[] = [];
    const storage: PrivateStorageClient = {
      from(bucket) {
        return {
          upload(path, body, options) {
            calls.push({ bucket, path, size: body.byteLength, options });
            return Promise.resolve({ data: {}, error: null });
          },
          remove() {
            return Promise.resolve({ data: {}, error: null });
          },
          createSignedUrl() {
            return Promise.resolve({ data: { signedUrl: "signed" }, error: null });
          },
        };
      },
    };
    const file = validateSourceFile({
      bytes: new Uint8Array([1, 2, 3]),
      extension: "pdf",
      mediaType: "application/pdf",
      sourceRole: "document",
    });
    const authorization: SourceUploadAuthorization = {
      bucket: "client-uploads",
      objectKey: `project-intelligence/ru/${UUID_A}/${UUID_B}/sources/${file.checksumHex}/document.pdf`,
      upsert: false,
      checksum: file.checksumHex,
      mediaType: file.mediaType,
      projectId: UUID_B,
      packageId: UUID_B,
    };

    await new ProjectSourceStorageAdapter(storage).uploadAuthorized(
      authorization,
      file,
    );

    expect(calls).toEqual([
      {
        bucket: "client-uploads",
        path: authorization.objectKey,
        size: 3,
        options: { contentType: "application/pdf", upsert: false },
      },
    ]);
  });

  it("server delivery never accepts a caller-supplied token digest", async () => {
    const calls: Array<Readonly<Record<string, unknown>> | undefined> = [];
    const client: PostgresRpcClient = {
      schema() {
        return {
          rpc(_functionName, args) {
            calls.push(args);
            return Promise.resolve({
              data: {
                operation: "create_invitation",
                replay: false,
                stateRevision: 2,
                result: {
                  invitationId: UUID_A,
                  projectId: UUID_B,
                  packageId: null,
                  scope: "project",
                  role: "architect",
                  expiresAt: "2026-07-18T00:00:00.000Z",
                },
              },
              error: null,
            });
          },
        };
      },
    };
    const inertStorage: PrivateStorageClient = {
      from() {
        throw new Error("not used");
      },
    };
    const service = new FoundationDeliveryService(
      new FoundationPostgresAdapter(client),
      new ProjectSourceStorageAdapter(inertStorage),
      "s".repeat(32),
      () => new Date("2026-07-17T00:00:00.000Z"),
    );

    const response = await service.createInvitation({
      requestId: "request-1",
      projectId: UUID_B,
      packageId: null,
      recipientEmail: "architect@example.test",
      role: "architect",
      ttlSeconds: 3600,
      expectedStateRevision: 1,
      idempotencyKey: "invite-1",
    });

    expect(response.error).toBeNull();
    expect(response.data?.invitationToken).toBeTypeOf("string");
    expect(calls[0]?.token_digest).toBeTypeOf("string");
    expect(calls[0]).not.toHaveProperty("invitationToken");
  });
});
