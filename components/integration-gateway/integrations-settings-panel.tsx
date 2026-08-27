"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";
import {
  connectionProjectionSchema,
} from "@/lib/integration-gateway/registry/connection-service";
import type { IntegrationProviderDescriptor } from "@/lib/integration-gateway/registry/provider-registry";
import { ru } from "@/lib/i18n/ru";

type OrganizationConnection = z.infer<typeof connectionProjectionSchema>;

const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

const errorMessages: Readonly<Record<string, string>> = {
  "integrations.errors.oauthTransportNotConfigured": ru.integrations.errors.oauthTransportNotConfigured,
  "integrations.errors.oauth_callback_not_configured": ru.integrations.errors.oauth_callback_not_configured,
  "integrations.errors.provider_worker_not_configured": ru.integrations.errors.provider_worker_not_configured,
  "integrations.errors.provider_webhook_not_configured": ru.integrations.errors.provider_webhook_not_configured,
  "integrations.errors.forbidden": ru.integrations.errors.forbidden,
  "integrations.errors.scope_conflict": ru.integrations.errors.scope_conflict,
  "integrations.errors.validation_failed": ru.integrations.errors.validation_failed,
};

function providerName(code: string): string {
  return ru.integrations.providerNames[code as keyof typeof ru.integrations.providerNames]
    ?? ru.projectConnections.unknownProvider;
}

function connectionModeLabel(mode: IntegrationProviderDescriptor["connectionMode"]): string {
  return ru.integrations.connectionModes[mode];
}

function legalLabel(state: IntegrationProviderDescriptor["legalState"]): string {
  if (state === "allowed") return ru.integrations.allowed;
  if (state === "staging_only") return ru.integrations.stagingOnly;
  return ru.integrations.blocked;
}

function statusLabel(status: string): string {
  return ru.integrations.statuses[status as keyof typeof ru.integrations.statuses]
    ?? ru.integrations.unknownStatus;
}

function safeReasonLabel(status: string): string | null {
  if (status === "degraded") return ru.integrations.safeReasons.degraded;
  if (status === "reauth_required") return ru.integrations.safeReasons.reauth_required;
  if (status === "disconnected") return ru.integrations.safeReasons.disconnected;
  return null;
}

function formatTimestamp(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short" });
}

async function responseMessage(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as {
    error?: { messageKey?: unknown };
  } | null;
  const key = typeof payload?.error?.messageKey === "string"
    ? payload.error.messageKey
    : null;
  return (key && errorMessages[key]) ?? ru.integrations.errors.requestFailed;
}

export function IntegrationsSettingsPanel({
  providers,
  connections,
  organizationId,
  enabled = true,
}: {
  readonly providers: readonly IntegrationProviderDescriptor[];
  readonly connections: readonly OrganizationConnection[];
  readonly organizationId: string | null;
  readonly enabled?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [disconnectConfirmation, setDisconnectConfirmation] = useState<string | null>(null);

  async function connect(provider: IntegrationProviderDescriptor) {
    if (!organizationId || provider.connectionMode !== "oauth") return;
    setPending(`connect:${provider.providerCode}`);
    setError(null);
    try {
      const response = await fetch(`/api/integrations/${encodeURIComponent(provider.providerCode)}/connect-intent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          requestedScopes: provider.providerCode === "google_drive" ? [GOOGLE_DRIVE_FILE_SCOPE] : [],
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const payload = await response.json() as { data?: { authorizationUrl?: unknown } };
      if (typeof payload.data?.authorizationUrl === "string") {
        window.location.assign(payload.data.authorizationUrl);
      } else {
        router.refresh();
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : ru.integrations.actionFailed);
    } finally {
      setPending(null);
    }
  }

  async function disconnect(connectionId: string) {
    if (disconnectConfirmation !== connectionId) {
      setDisconnectConfirmation(connectionId);
      return;
    }
    setPending(`disconnect:${connectionId}`);
    setError(null);
    try {
      const response = await fetch(`/api/integrations/${connectionId}/disconnect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ reason: "human_requested" }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      setDisconnectConfirmation(null);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : ru.integrations.actionFailed);
    } finally {
      setPending(null);
    }
  }

  if (!enabled) {
    return <p className="border-y border-line py-5 text-sm text-muted">{ru.integrations.disabled}</p>;
  }

  return (
    <section className="space-y-5" aria-busy={pending !== null}>
      <div>
        <h1 className="font-display text-3xl font-semibold">{ru.integrations.title}</h1>
        <p className="mt-1 text-sm text-muted">{ru.integrations.intro}</p>
      </div>
      {error && (
        <p className="border-y border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      {providers.length === 0 ? (
        <p className="border-y border-line py-5 text-sm text-muted">{ru.integrations.empty}</p>
      ) : (
        <div className="divide-y divide-line border-y border-line bg-white">
          {providers.map((provider) => {
            const providerConnections = connections.filter(
              (connection) => connection.providerCode === provider.providerCode,
            );
            const activeConnection = providerConnections.find(
              (connection) => connection.status !== "disconnected",
            );
            const actionKey = `connect:${provider.providerCode}`;
            const canConnect = provider.connectionMode === "oauth"
              && provider.legalState !== "blocked"
              && organizationId !== null;
            return (
              <article key={provider.providerCode} className="space-y-4 px-4 py-5 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{providerName(provider.providerCode)}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {connectionModeLabel(provider.connectionMode)} · {ru.integrations.legalState}: {legalLabel(provider.legalState)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost min-h-11"
                    disabled={!canConnect || pending !== null}
                    onClick={() => void connect(provider)}
                    title={!organizationId ? ru.integrations.noOrganization : undefined}
                  >
                    {pending === actionKey
                      ? ru.integrations.actionPending
                      : activeConnection && ["reauth_required", "disconnected"].includes(activeConnection.status)
                        ? ru.integrations.reconnect
                        : canConnect ? ru.integrations.connect : ru.integrations.disabled}
                  </button>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">
                    {ru.integrations.capabilities}
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink">
                    {provider.capabilities.capabilities.map((capability) => (
                      <li key={capability}>
                        {ru.integrations.capabilityNames[capability as keyof typeof ru.integrations.capabilityNames] ?? capability}
                      </li>
                    ))}
                  </ul>
                </div>
                {providerConnections.length === 0 ? (
                  <p className="text-sm text-muted">{ru.integrations.notConnected}</p>
                ) : providerConnections.map((connection) => {
                  const connectedAt = formatTimestamp(connection.createdAt);
                  const lastSync = formatTimestamp(connection.lastSuccessfulSyncAt);
                  const disconnectKey = `disconnect:${connection.connectionId}`;
                  return (
                    <div key={connection.connectionId} className="border-t border-line pt-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{connection.displayLabel ?? providerName(connection.providerCode)}</p>
                          <p className="mt-1 text-muted">
                            {statusLabel(connection.status)} · {ru.integrations.connectedBy(connection.createdBy.slice(0, 8))}
                          </p>
                          {safeReasonLabel(connection.status) && (
                            <p className="mt-1 text-xs text-muted">{safeReasonLabel(connection.status)}</p>
                          )}
                          {connectedAt && <p className="mt-1 text-muted">{ru.integrations.connectedAt(connectedAt)}</p>}
                          <p className="mt-1 text-muted">{ru.integrations.projectsUsing(connection.projectsUsing)}</p>
                          <p className="mt-1 text-muted">{ru.integrations.lastSync(lastSync)}</p>
                        </div>
                        {connection.status !== "disconnected" && (
                          <button
                            type="button"
                            className="btn-ghost min-h-11"
                            disabled={pending !== null}
                            onClick={() => void disconnect(connection.connectionId)}
                          >
                            {pending === disconnectKey
                              ? ru.integrations.actionPending
                              : disconnectConfirmation === connection.connectionId
                                ? ru.integrations.disconnectConfirm
                                : ru.integrations.disconnect}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
