import {
  FOUNDATION_CONTRACT_VERSION,
  FoundationPostgresAdapter,
  ProjectIntelligenceAdapterError,
  errorEnvelope,
  type CommandMutation,
  type FoundationEnvelope,
  type GuestGrantResult,
  type InvitationResult,
} from "../../adapters/postgres";
import {
  ProjectSourceStorageAdapter,
  deriveOpaqueToken,
  digestOpaqueToken,
  validateSourceFile,
  type SourceRole,
} from "../../adapters/storage";

const MAX_INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;
const MAX_GUEST_TTL_SECONDS = 7 * 24 * 60 * 60;

function successEnvelope<T>(requestId: string, data: T): FoundationEnvelope<T> {
  return {
    contractVersion: FOUNDATION_CONTRACT_VERSION,
    requestId,
    data,
    error: null,
  };
}

function validationEnvelope(
  requestId: string,
  code: "validation_failed" | "unsupported_source" = "validation_failed",
): FoundationEnvelope<never> {
  return {
    contractVersion: FOUNDATION_CONTRACT_VERSION,
    requestId,
    data: null,
    error: {
      code,
      messageKey: `project_ceo.error.${code}`,
    },
  };
}

function boundedExpiry(
  now: Date,
  ttlSeconds: number,
  maximumSeconds: number,
): string {
  if (
    !Number.isSafeInteger(ttlSeconds) ||
    ttlSeconds <= 0 ||
    ttlSeconds > maximumSeconds
  ) {
    throw new Error("Invalid token TTL");
  }
  return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}

async function asEnvelope<T>(
  requestId: string,
  operation: () => Promise<T>,
): Promise<FoundationEnvelope<T>> {
  try {
    return successEnvelope(requestId, await operation());
  } catch (error) {
    if (error instanceof ProjectIntelligenceAdapterError) {
      return errorEnvelope(requestId, error);
    }
    return validationEnvelope(requestId);
  }
}

/**
 * Server-route orchestration. Actor, organization and role never appear in these
 * inputs; request-bound SQL derives them from JWT and active scoped membership.
 */
export class FoundationDeliveryService {
  constructor(
    private readonly postgres: FoundationPostgresAdapter,
    private readonly sourceStorage: ProjectSourceStorageAdapter,
    private readonly tokenSecret: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  enroll(input: {
    readonly requestId: string;
    readonly projectId: string;
    readonly idempotencyKey: string;
  }) {
    return asEnvelope(input.requestId, () =>
      this.postgres.enrollOrganizationProject(input),
    );
  }

  createInvitation(input: {
    readonly requestId: string;
    readonly projectId: string;
    readonly packageId: string | null;
    readonly recipientEmail: string;
    readonly role: string;
    readonly ttlSeconds: number;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<
    FoundationEnvelope<
      CommandMutation<InvitationResult> & { readonly invitationToken: string }
    >
  > {
    return asEnvelope(input.requestId, async () => {
      const token = deriveOpaqueToken({
        secret: this.tokenSecret,
        namespace: "invitation",
        scope: `${input.projectId}/${input.packageId ?? "project"}`,
        idempotencyKey: input.idempotencyKey,
      });
      const command = await this.postgres.createInvitation({
        projectId: input.projectId,
        packageId: input.packageId,
        recipientEmail: input.recipientEmail,
        role: input.role,
        expiresAt: boundedExpiry(
          this.now(),
          input.ttlSeconds,
          MAX_INVITATION_TTL_SECONDS,
        ),
        tokenDigest: token.tokenDigest,
        expectedStateRevision: input.expectedStateRevision,
        idempotencyKey: input.idempotencyKey,
      });
      return { ...command, invitationToken: token.rawToken };
    });
  }

  acceptInvitation(input: {
    readonly requestId: string;
    readonly invitationToken: string;
    readonly idempotencyKey: string;
  }) {
    return asEnvelope(input.requestId, () =>
      this.postgres.acceptInvitation({
        tokenDigest: digestOpaqueToken(input.invitationToken),
        idempotencyKey: input.idempotencyKey,
      }),
    );
  }

  createGuestGrant(input: {
    readonly requestId: string;
    readonly projectId: string;
    readonly packageId: string;
    readonly versionId: string;
    readonly allowAcknowledgement: boolean;
    readonly ttlSeconds: number;
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<
    FoundationEnvelope<
      CommandMutation<GuestGrantResult> & { readonly guestToken: string }
    >
  > {
    return asEnvelope(input.requestId, async () => {
      const token = deriveOpaqueToken({
        secret: this.tokenSecret,
        namespace: "guest",
        scope: `${input.projectId}/${input.packageId}/${input.versionId}`,
        idempotencyKey: input.idempotencyKey,
      });
      const command = await this.postgres.createGuestGrant({
        projectId: input.projectId,
        packageId: input.packageId,
        versionId: input.versionId,
        allowAcknowledgement: input.allowAcknowledgement,
        expiresAt: boundedExpiry(
          this.now(),
          input.ttlSeconds,
          MAX_GUEST_TTL_SECONDS,
        ),
        tokenDigest: token.tokenDigest,
        expectedStateRevision: input.expectedStateRevision,
        idempotencyKey: input.idempotencyKey,
      });
      return { ...command, guestToken: token.rawToken };
    });
  }

  readGuestRelease(input: {
    readonly requestId: string;
    readonly guestToken: string;
  }) {
    return asEnvelope(input.requestId, async () => {
      const envelope = await this.postgres.readGuestRelease(
        digestOpaqueToken(input.guestToken),
      );
      if (envelope.error || !envelope.data) {
        throw new ProjectIntelligenceAdapterError(
          envelope.error?.code ?? "internal_error",
          null,
        );
      }
      return envelope.data;
    });
  }

  async uploadAndIngestSource(input: {
    readonly requestId: string;
    readonly projectId: string;
    readonly packageId: string;
    readonly bytes: Uint8Array;
    readonly originalFilename: string;
    readonly extension: string;
    readonly mediaType: string;
    readonly sourceRole: SourceRole;
    readonly source: Readonly<Record<string, unknown>>;
    readonly fragments: readonly unknown[];
    readonly nodes: readonly unknown[];
    readonly revisions: readonly unknown[];
    readonly evidenceLinks: readonly unknown[];
    readonly edges: readonly unknown[];
    readonly expectedStateRevision: number;
    readonly idempotencyKey: string;
  }): Promise<FoundationEnvelope<CommandMutation<Readonly<Record<string, unknown>>>>> {
    let cleanup: { readonly bucket: "client-uploads"; readonly objectKey: string } | null =
      null;
    try {
      const file = validateSourceFile({
        bytes: input.bytes,
        extension: input.extension,
        mediaType: input.mediaType,
        sourceRole: input.sourceRole,
      });
      const authorization = await this.postgres.authorizeSourceUpload({
        projectId: input.projectId,
        packageId: input.packageId,
        checksumHex: file.checksumHex,
        mediaType: file.mediaType,
        extension: file.extension,
        sizeBytes: file.sizeBytes,
        sourceRole: file.sourceRole,
      });
      if (authorization.error || !authorization.data) {
        return authorization as FoundationEnvelope<never>;
      }
      const uploaded = await this.sourceStorage.uploadAuthorized(
        authorization.data,
        file,
      );
      if (uploaded.created) {
        cleanup = {
          bucket: uploaded.bucket,
          objectKey: uploaded.objectKey,
        };
      }
      const command = await this.postgres.ingestSourceGraph({
        projectId: input.projectId,
        source: {
          ...input.source,
          packageId: input.packageId,
          checksumHex: file.checksumHex,
          storageObjectPath: authorization.data.objectKey,
          metadata: {
            ...(typeof input.source.metadata === "object" &&
            input.source.metadata !== null
              ? input.source.metadata
              : {}),
            originalFilename: input.originalFilename,
            mediaType: file.mediaType,
            extension: file.extension,
            sizeBytes: file.sizeBytes,
            sourceRole: file.sourceRole,
          },
        },
        fragments: input.fragments,
        nodes: input.nodes,
        revisions: input.revisions,
        evidenceLinks: input.evidenceLinks,
        edges: input.edges,
        expectedStateRevision: input.expectedStateRevision,
        idempotencyKey: input.idempotencyKey,
      });
      cleanup = null;
      return successEnvelope(input.requestId, command);
    } catch (error) {
      if (cleanup) {
        await this.sourceStorage.cleanupAuthorized(cleanup);
      }
      if (error instanceof ProjectIntelligenceAdapterError) {
        return errorEnvelope(input.requestId, error);
      }
      const unsupported =
        error instanceof Error &&
        error.message === "project_ceo.unsupported_source";
      return validationEnvelope(
        input.requestId,
        unsupported ? "unsupported_source" : "validation_failed",
      );
    }
  }

  createSourceSignedUrl(input: {
    readonly requestId: string;
    readonly projectId: string;
    readonly sourceId: string;
    readonly ttlSeconds?: number;
  }): Promise<
    FoundationEnvelope<{ readonly signedUrl: string; readonly expiresIn: number }>
  > {
    return asEnvelope(input.requestId, async () => {
      const authorization = await this.postgres.authorizeSourceDownload({
        projectId: input.projectId,
        sourceId: input.sourceId,
        ttlSeconds: Math.min(input.ttlSeconds ?? 900, 900),
      });
      if (authorization.error || !authorization.data) {
        throw new ProjectIntelligenceAdapterError(
          authorization.error?.code ?? "internal_error",
          null,
        );
      }
      return this.sourceStorage.createAuthorizedSignedUrl(authorization.data);
    });
  }
}
