import type {
  ConnectorStatus,
  IntegrationCapability,
  IntegrationProviderCode,
} from "./capability";

export interface RequestActorContext {
  readonly actorId: string;
  readonly organizationId: string;
  readonly projectId?: string;
  readonly correlationId: string;
  readonly effectiveCapabilities: readonly string[];
}

export interface ConnectionRef {
  readonly connectionId: string;
  readonly provider: IntegrationProviderCode;
  readonly organizationId: string;
}

export interface ExternalObjectRef {
  readonly projectConnectionId: string;
  /** Private provider key. Never include this in logs or browser DTOs. */
  readonly providerObjectKey: string;
  readonly expectedRevision?: string;
}

export interface ExternalObjectPage {
  readonly items: readonly {
    readonly opaqueKey: string;
    readonly kind: "file" | "folder" | "board" | "design" | "other";
    readonly displayName?: string;
    readonly mimeType?: string;
    readonly sizeBytes?: number;
    readonly revision?: string;
    readonly modifiedAt?: string;
  }[];
  readonly nextCursor?: string;
}

export interface ImportCandidateResult {
  readonly candidateId: string;
  readonly state: "candidate";
  readonly exactExternalRevision?: string;
}

export interface VerifiedWebhook {
  readonly deliveryIdHash: string;
  readonly payloadSha256: string;
  readonly eventType: string;
  readonly sanitizedEnvelope: unknown;
}

export interface ConnectorHealth {
  readonly status: ConnectorStatus;
  readonly checkedAt: string;
  readonly reasonCode?: string;
}

export interface IntegrationConnector {
  readonly provider: IntegrationProviderCode;
  readonly capabilities: readonly IntegrationCapability[];

  startConnection(
    actor: RequestActorContext,
    requestedScopes: readonly string[],
  ): Promise<{ readonly authorizationUrl: string; readonly intentId: string }>;

  completeConnection(input: {
    readonly callbackUrl: URL;
    readonly correlationId: string;
  }): Promise<ConnectionRef>;

  disconnect(
    actor: RequestActorContext,
    connection: ConnectionRef,
  ): Promise<void>;

  listObjects(
    actor: RequestActorContext,
    connection: ConnectionRef,
    cursor?: string,
  ): Promise<ExternalObjectPage>;

  importObject(
    actor: RequestActorContext,
    ref: ExternalObjectRef,
  ): Promise<ImportCandidateResult>;

  verifyWebhook?(request: Request): Promise<VerifiedWebhook>;

  exportPublishedArtifact?(input: {
    readonly actor: RequestActorContext;
    readonly connection: ConnectionRef;
    readonly publishedArtifactId: string;
    readonly idempotencyKey: string;
  }): Promise<{ readonly opaqueKey: string; readonly revision?: string }>;

  health(connection: ConnectionRef): Promise<ConnectorHealth>;
}
