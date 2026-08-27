import "server-only";

import type { PostgresRpcClient } from "@/lib/project-intelligence/adapters/postgres/contracts";
import {
  createIntegrationWorkerClient,
  createIntegrationWorkerResources,
} from "../runtime/worker-client";
import {
  createSecretStoreFromEnv,
  type SecretStore,
} from "../core/secret-store";
import {
  SecretStoreGoogleDriveCredentialStore,
  SecretStoreGoogleDriveChannelStore,
  SecretStoreGoogleDrivePkceStore,
  SecretStoreGoogleDriveSelectionStore,
} from "./secret-store-adapters";
import { GoogleDriveOAuthFlow, PostgresGoogleDriveOAuthRegistry } from "./oauth-flow";
import { googleDriveOAuthConfigFromEnv } from "./oauth";
import { GoogleDriveChannelWorker } from "./channel-worker";
import { GoogleDriveWebhookChannelLifecycle } from "./channel-lifecycle";
import {
  GoogleDriveProviderTransport,
  GoogleDriveUserInfoResolver,
  PostgresGoogleDriveCredentialResolver,
} from "./provider-transport";

let cachedStore: { readonly adapter: string; readonly store: SecretStore } | null = null;

function secretStore(): SecretStore {
  const adapter = process.env.REMHAOS_SECRET_STORE_ADAPTER?.trim().toLowerCase() ?? "";
  if (!cachedStore || cachedStore.adapter !== adapter) {
    cachedStore = { adapter, store: createSecretStoreFromEnv() };
  }
  return cachedStore.store;
}

export function createGoogleDriveOAuthFlow(input: {
  readonly client: PostgresRpcClient;
  readonly fetchImpl?: typeof fetch;
}): GoogleDriveOAuthFlow {
  const store = secretStore();
  const credentialStore = new SecretStoreGoogleDriveCredentialStore(store);
  return new GoogleDriveOAuthFlow({
    config: googleDriveOAuthConfigFromEnv(),
    registry: new PostgresGoogleDriveOAuthRegistry(input.client),
    pkceStore: new SecretStoreGoogleDrivePkceStore(store),
    credentialStore,
    accountResolver: new GoogleDriveUserInfoResolver(input.fetchImpl),
    fetchImpl: input.fetchImpl ?? fetch,
  });
}

export function createGoogleDriveProviderTransport(input?: {
  readonly client?: PostgresRpcClient;
  readonly fetchImpl?: typeof fetch;
}): GoogleDriveProviderTransport {
  const client = input?.client ?? createIntegrationWorkerClient();
  const store = new SecretStoreGoogleDriveCredentialStore(secretStore());
  return new GoogleDriveProviderTransport(
    new PostgresGoogleDriveCredentialResolver(client, store),
    input?.fetchImpl ?? fetch,
  );
}

export function createGoogleDriveSelectionStore(): SecretStoreGoogleDriveSelectionStore {
  return new SecretStoreGoogleDriveSelectionStore(secretStore());
}

export function createGoogleDriveWebhookChannelLifecycle(): GoogleDriveWebhookChannelLifecycle {
  const resources = createIntegrationWorkerResources();
  return new GoogleDriveWebhookChannelLifecycle(
    new GoogleDriveChannelWorker(resources.client),
    createGoogleDriveProviderTransport({ client: resources.client }),
    new SecretStoreGoogleDriveChannelStore(secretStore()),
  );
}

export async function revokeGoogleDriveConnectionIfConfigured(input: {
  readonly actor: import("../core/connector").RequestActorContext;
  readonly connection: import("../core/connector").ConnectionRef;
}): Promise<"revoked" | "not_attempted" | "not_revoked"> {
  if (process.env.REMHAOS_GOOGLE_DRIVE_REVOKE_ENABLED !== "true") return "not_attempted";
  try {
    const resources = createIntegrationWorkerResources();
    const provider = createGoogleDriveProviderTransport({ client: resources.client });
    const channels = new GoogleDriveChannelWorker(resources.client);
    const channelSecrets = new SecretStoreGoogleDriveChannelStore(secretStore());
    for (const channel of await channels.listActiveChannels(input.connection.connectionId)) {
      const secret = await channelSecrets.get(channel.channelId);
      if (!secret) throw new Error("google_drive_channel_secret_missing");
      await provider.stopWebhookChannel({
        actor: input.actor,
        connection: input.connection,
        channelId: secret.providerChannelId,
        resourceId: secret.providerResourceId,
      });
      await channels.stopChannel({
        organizationId: input.connection.organizationId,
        connectionId: input.connection.connectionId,
        channelId: channel.channelId,
        reason: "connection_disconnect",
        idempotencyKey: `google-drive-disconnect-channel-${channel.channelId}`,
      });
      await channelSecrets.delete(channel.channelId);
    }
    await provider.disconnect(input);
    return "revoked";
  } catch {
    return "not_revoked";
  }
}
