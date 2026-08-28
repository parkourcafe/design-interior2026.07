import type {
  ConnectionRef,
  ConnectorHealth,
  ExternalObjectPage,
  ExternalObjectRef,
  ImportCandidateResult,
  IntegrationConnector,
  RequestActorContext,
  VerifiedWebhook,
} from "../core/connector";
import type { IntegrationCapability } from "../core/capability";
import { assertGoogleDriveScopes, assertSelectedGoogleDriveObject } from "./policy";

export class GoogleDriveCredentialsRequiredError extends Error {
  constructor() {
    super("google_drive_credentials_required");
    this.name = "GoogleDriveCredentialsRequiredError";
  }
}

export interface GoogleDriveTransport {
  startAuthorization(input: {
    readonly actor: RequestActorContext;
    readonly scopes: readonly string[];
  }): Promise<{ readonly authorizationUrl: string; readonly intentId: string }>;
  completeAuthorization(input: {
    readonly callbackUrl: URL;
    readonly correlationId: string;
  }): Promise<ConnectionRef>;
  disconnect(input: { readonly actor: RequestActorContext; readonly connection: ConnectionRef }): Promise<void>;
  listObjects(input: {
    readonly actor: RequestActorContext;
    readonly connection: ConnectionRef;
    readonly cursor?: string;
  }): Promise<ExternalObjectPage>;
  importObject(input: {
    readonly actor: RequestActorContext;
    readonly ref: ExternalObjectRef;
  }): Promise<ImportCandidateResult>;
  verifyWebhook?(request: Request): Promise<VerifiedWebhook>;
  health(connection: ConnectionRef): Promise<ConnectorHealth>;
}

export class GoogleDriveConnector implements IntegrationConnector {
  readonly provider = "google_drive" as const;
  readonly capabilities: readonly IntegrationCapability[] = [
    "list_objects",
    "import_object",
    "receive_webhook",
  ];

  constructor(private readonly transport: GoogleDriveTransport | null) {}

  private requireTransport(): GoogleDriveTransport {
    if (!this.transport || process.env.REMHAOS_GOOGLE_DRIVE_ENABLED !== "true") {
      throw new GoogleDriveCredentialsRequiredError();
    }
    return this.transport;
  }

  startConnection(actor: RequestActorContext, requestedScopes: readonly string[]) {
    return this.requireTransport().startAuthorization({
      actor,
      scopes: assertGoogleDriveScopes(requestedScopes),
    });
  }

  completeConnection(input: { readonly callbackUrl: URL; readonly correlationId: string }) {
    return this.requireTransport().completeAuthorization(input);
  }

  disconnect(actor: RequestActorContext, connection: ConnectionRef): Promise<void> {
    return this.requireTransport().disconnect({ actor, connection });
  }

  listObjects(actor: RequestActorContext, connection: ConnectionRef, cursor?: string) {
    return this.requireTransport().listObjects({ actor, connection, cursor });
  }

  importObject(actor: RequestActorContext, ref: ExternalObjectRef) {
    assertSelectedGoogleDriveObject({
      opaqueKey: ref.providerObjectKey,
      kind: "file",
      displayName: "selected-object",
      mimeType: "application/octet-stream",
      sizeBytes: null,
      revision: ref.expectedRevision ?? "selected",
      modifiedAt: null,
    });
    return this.requireTransport().importObject({ actor, ref });
  }

  verifyWebhook(request: Request): Promise<VerifiedWebhook> {
    const transport = this.requireTransport();
    if (!transport.verifyWebhook) throw new GoogleDriveCredentialsRequiredError();
    return transport.verifyWebhook(request);
  }

  health(connection: ConnectionRef): Promise<ConnectorHealth> {
    return this.requireTransport().health(connection);
  }
}
