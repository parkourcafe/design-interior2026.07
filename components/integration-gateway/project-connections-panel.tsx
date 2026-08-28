"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { z } from "zod";
import {
  connectionProjectionSchema,
  projectConnectionProjectionSchema,
} from "@/lib/integration-gateway/registry/connection-service";
import type { IntegrationProviderDescriptor } from "@/lib/integration-gateway/registry/provider-registry";
import { ru } from "@/lib/i18n/ru";

type ProjectConnection = z.infer<typeof projectConnectionProjectionSchema>;
type OrganizationConnection = z.infer<typeof connectionProjectionSchema>;

const errorMessages: Readonly<Record<string, string>> = {
  "integrations.errors.notFound": ru.integrations.errors.notFound,
  "integrations.errors.forbidden": ru.integrations.errors.forbidden,
  "integrations.errors.scope_conflict": ru.integrations.errors.scope_conflict,
  "integrations.errors.validation_failed": ru.integrations.errors.validation_failed,
};

function providerName(code: string): string {
  return ru.integrations.providerNames[code as keyof typeof ru.integrations.providerNames]
    ?? ru.projectConnections.unknownProvider;
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

export function ProjectConnectionsPanel({
  projectId,
  connections,
  availableConnections,
  providers,
  canManage,
}: {
  readonly projectId: string;
  readonly connections: readonly ProjectConnection[];
  readonly availableConnections: readonly OrganizationConnection[];
  readonly providers: readonly IntegrationProviderDescriptor[];
  readonly canManage: boolean;
}) {
  const router = useRouter();
  const firstBindableConnection = availableConnections.find(
    (connection) => !connections.some(
      (bound) => bound.connectionId === connection.connectionId,
    ) && connection.status !== "disconnected",
  );
  const [selectedConnectionId, setSelectedConnectionId] = useState(
    firstBindableConnection?.connectionId ?? "",
  );
  const [selectedCapabilities, setSelectedCapabilities] = useState<string[]>(() => {
    const first = firstBindableConnection;
    const provider = providers.find((item) => item.providerCode === first?.providerCode);
    return provider?.capabilities.capabilities.slice() ?? [];
  });
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unbindConfirmation, setUnbindConfirmation] = useState<string | null>(null);

  const boundConnectionIds = useMemo(
    () => new Set(connections.map((connection) => connection.connectionId)),
    [connections],
  );
  const bindableConnections = availableConnections.filter(
    (connection) => !boundConnectionIds.has(connection.connectionId)
      && connection.status !== "disconnected",
  );
  const selectedConnection = availableConnections.find(
    (connection) => connection.connectionId === selectedConnectionId,
  );
  const selectedProvider = providers.find(
    (provider) => provider.providerCode === selectedConnection?.providerCode,
  );

  function selectConnection(connectionId: string) {
    setSelectedConnectionId(connectionId);
    const connection = availableConnections.find((item) => item.connectionId === connectionId);
    const provider = providers.find((item) => item.providerCode === connection?.providerCode);
    setSelectedCapabilities(provider?.capabilities.capabilities.slice() ?? []);
  }

  async function bind() {
    if (!selectedConnectionId || selectedCapabilities.length === 0) return;
    setPending("bind");
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/connections`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          connectionId: selectedConnectionId,
          capabilities: selectedCapabilities,
        }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : ru.integrations.actionFailed);
    } finally {
      setPending(null);
    }
  }

  async function unbind(projectConnectionId: string) {
    if (unbindConfirmation !== projectConnectionId) {
      setUnbindConfirmation(projectConnectionId);
      return;
    }
    setPending(`unbind:${projectConnectionId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/connections/${projectConnectionId}/unbind`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ reason: "human_requested" }),
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      setUnbindConfirmation(null);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : ru.integrations.actionFailed);
    } finally {
      setPending(null);
    }
  }

  async function requestSync(projectConnectionId: string) {
    setPending(`sync:${projectConnectionId}`);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/connections/${projectConnectionId}/sync`,
        {
          method: "POST",
          headers: {
            "Idempotency-Key": crypto.randomUUID(),
          },
        },
      );
      if (!response.ok) throw new Error(await responseMessage(response));
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : ru.integrations.actionFailed);
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="space-y-5" aria-busy={pending !== null}>
      <div>
        <h1 className="font-display text-3xl font-semibold">{ru.projectConnections.title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{ru.projectConnections.hint}</p>
      </div>
      {error && (
        <p className="border-y border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      {canManage && (
        <div className="border-y border-line py-4">
          <h2 className="font-semibold">{ru.integrations.projectBinding}</h2>
          {bindableConnections.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{ru.integrations.projectBindUnavailable}</p>
          ) : (
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <label className="block text-sm">
                <span className="mb-1 block text-muted">{ru.integrations.projectSelection}</span>
                <select
                  className="input min-h-11 w-full"
                  value={selectedConnectionId}
                  onChange={(event) => selectConnection(event.target.value)}
                  aria-label={ru.integrations.projectSelection}
                >
                  {bindableConnections.map((connection) => (
                    <option key={connection.connectionId} value={connection.connectionId}>
                      {connection.displayLabel ?? providerName(connection.providerCode)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-muted">{ru.projectConnections.scope}</span>
                <select
                  className="input min-h-11 w-full"
                  multiple
                  size={Math.min(4, Math.max(2, selectedProvider?.capabilities.capabilities.length ?? 2))}
                  value={selectedCapabilities}
                  onChange={(event) => setSelectedCapabilities(
                    [...event.target.selectedOptions].map((option) => option.value),
                  )}
                  aria-label={ru.projectConnections.scope}
                >
                  {(selectedProvider?.capabilities.capabilities ?? []).map((capability) => (
                    <option key={capability} value={capability}>
                      {ru.integrations.capabilityNames[capability as keyof typeof ru.integrations.capabilityNames] ?? capability}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn-primary min-h-11"
                disabled={pending !== null || selectedCapabilities.length === 0}
                onClick={() => void bind()}
              >
                {pending === "bind" ? ru.integrations.actionPending : ru.integrations.projectBinding}
              </button>
            </div>
          )}
        </div>
      )}
      {connections.length === 0 ? (
        <p className="border-y border-line py-5 text-sm text-muted">{ru.projectConnections.empty}</p>
      ) : (
        <div className="divide-y divide-line border-y border-line bg-white">
          {connections.map((connection) => {
            const boundAt = formatTimestamp(connection.boundAt);
            const lastSync = formatTimestamp(connection.lastSuccessfulSyncAt);
            const unbindKey = `unbind:${connection.projectConnectionId}`;
            return (
              <article key={connection.projectConnectionId} className="space-y-3 px-4 py-5 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-medium">{connection.displayLabel ?? providerName(connection.providerCode)}</h2>
                    <p className="mt-1 text-sm text-muted">
                      {providerName(connection.providerCode)} · {statusLabel(connection.status)}
                    </p>
                    {safeReasonLabel(connection.status) && (
                      <p className="mt-1 text-xs text-muted">{safeReasonLabel(connection.status)}</p>
                    )}
                  </div>
                  {canManage && (
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        className="btn-ghost min-h-11"
                        disabled={pending !== null || !["connected", "degraded"].includes(connection.status)}
                        onClick={() => void requestSync(connection.projectConnectionId)}
                      >
                        {pending === `sync:${connection.projectConnectionId}`
                          ? ru.integrations.actionPending
                          : ru.integrations.manualSync}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost min-h-11"
                        disabled={pending !== null}
                        onClick={() => void unbind(connection.projectConnectionId)}
                      >
                        {pending === unbindKey
                          ? ru.integrations.actionPending
                          : unbindConfirmation === connection.projectConnectionId
                            ? ru.integrations.projectUnbindConfirm
                            : ru.integrations.projectUnbind}
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted">
                  {ru.projectConnections.scope}: {connection.allowedCapabilities
                    .map((capability) => ru.integrations.capabilityNames[capability as keyof typeof ru.integrations.capabilityNames] ?? capability)
                    .join(", ")} · {ru.integrations.manualSync}
                </p>
                {boundAt && <p className="text-xs text-muted">{ru.integrations.connectedAt(boundAt)}</p>}
                <p className="text-xs text-muted">{ru.integrations.lastSync(lastSync)}</p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
