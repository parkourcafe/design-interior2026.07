"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";
import type { ProjectLinkProjection } from "@/lib/integration-gateway/links/project-link-service";
import type { FileIntakeProjection } from "@/lib/integration-gateway/file-intake/service";
import type { TelegramCandidateProjection } from "@/lib/integration-gateway/telegram/service";
import type { importCandidateProjectionSchema } from "@/lib/integration-gateway/registry/connection-service";
import { ru } from "@/lib/i18n/ru";

type ImportCandidateProjection = z.infer<typeof importCandidateProjectionSchema>;

const errorMessages: Readonly<Record<string, string>> = {
  "integrations.errors.forbidden": ru.integrations.errors.forbidden,
  "integrations.errors.scope_conflict": ru.integrations.errors.scope_conflict,
  "integrations.errors.validation_failed": ru.integrations.errors.validation_failed,
};

function telegramSourceLabel(kind: TelegramCandidateProjection["sourceKind"]): string {
  return kind === "attachment" ? ru.projectConnections.file : ru.projectConnections.message;
}

function importSourceLabel(kind: ImportCandidateProjection["sourceKind"]): string {
  return ru.projectConnections.sourceKinds[kind];
}

function importTargetLabel(kind: ImportCandidateProjection["targetKind"]): string {
  return ru.projectConnections.targetKinds[kind];
}

function importProviderLabel(
  providerCode: NonNullable<ImportCandidateProjection["provenance"]["providerCode"]>,
): string {
  return ru.integrations.providerNames[providerCode] ?? ru.projectConnections.unknownProvider;
}

function candidateStatusLabel(status: ImportCandidateProjection["status"]): string {
  if (status === "candidate") return ru.projectConnections.candidate;
  if (status === "reviewing") return ru.projectConnections.reviewPending;
  if (status === "accepted") return ru.projectConnections.accepted;
  if (status === "rejected") return ru.projectConnections.rejected;
  return ru.projectConnections.candidateSuperseded;
}

function telegramStatusLabel(status: TelegramCandidateProjection["status"]): string {
  if (status === "accepted") return ru.projectConnections.accepted;
  if (status === "rejected") return ru.projectConnections.rejected;
  return ru.projectConnections.reviewPending;
}

function scanStateLabel(state: string): string {
  return ru.projectConnections.scanStates[state as keyof typeof ru.projectConnections.scanStates]
    ?? ru.projectConnections.scanState;
}

function fileStatusLabel(status: string): string {
  return ru.projectConnections.fileStatuses[status as keyof typeof ru.projectConnections.fileStatuses]
    ?? ru.projectConnections.reviewPending;
}

function linkVisibilityLabel(visibility: "internal" | "candidate" | "published_to_client"): string {
  return ru.projectConnections.linkVisibility[visibility];
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

export function ProjectInboxPanel({
  projectId,
  links,
  files,
  telegramCandidates,
  importCandidates,
}: {
  readonly projectId: string;
  readonly links: readonly ProjectLinkProjection[];
  readonly files: readonly FileIntakeProjection[];
  readonly telegramCandidates: readonly TelegramCandidateProjection[];
  readonly importCandidates: readonly ImportCandidateProjection[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [targetKinds, setTargetKinds] = useState<
    Record<string, ImportCandidateProjection["targetKind"]>
  >(() => Object.fromEntries(
    importCandidates.map((candidate) => [candidate.candidateId, candidate.targetKind]),
  ) as Record<string, ImportCandidateProjection["targetKind"]>);
  const total = links.length + files.length + telegramCandidates.length + importCandidates.length;

  function reasonFor(id: string): string {
    return reasons[id] ?? "";
  }

  function setReason(id: string, value: string) {
    setReasons((current) => ({ ...current, [id]: value }));
  }

  function targetKindFor(candidate: ImportCandidateProjection): ImportCandidateProjection["targetKind"] {
    return targetKinds[candidate.candidateId] ?? candidate.targetKind;
  }

  function setTargetKind(candidateId: string, value: ImportCandidateProjection["targetKind"]) {
    setTargetKinds((current) => ({ ...current, [candidateId]: value }));
  }

  async function reviewImportCandidate(
    candidate: ImportCandidateProjection,
    decision: "accepted" | "rejected",
  ) {
    const reason = reasonFor(candidate.candidateId).trim();
    if (decision === "rejected" && !reason) {
      setError(ru.projectConnections.reviewReasonRequired);
      return;
    }
    setPending(candidate.candidateId);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/imports/${candidate.candidateId}/review`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({
            decision,
            target: {
              targetKind: targetKindFor(candidate),
              ...(reason ? { reason } : {}),
            },
          }),
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

  async function reviewTelegramCandidate(
    candidate: TelegramCandidateProjection,
    decision: "accepted" | "rejected",
  ) {
    const reason = reasonFor(candidate.candidateId).trim();
    if (!reason) {
      setError(ru.projectConnections.reviewReasonRequired);
      return;
    }
    setPending(candidate.candidateId);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/inbox/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          candidateId: candidate.candidateId,
          decision,
          reason,
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

  async function reviewFileIntake(
    file: FileIntakeProjection,
    decision: "accepted" | "rejected",
  ) {
    const reason = reasonFor(file.intakeId).trim();
    if (!reason) {
      setError(ru.projectConnections.fileReviewReasonRequired);
      return;
    }
    setPending(file.intakeId);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/file-intakes/${file.intakeId}/review`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ decision, reason }),
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

  async function publishFileIntake(file: FileIntakeProjection) {
    setPending(file.intakeId);
    setError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/file-intakes/${file.intakeId}/publish`,
        {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
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

  function reviewControls(
    id: string,
    canReview: boolean,
    onReview: (decision: "accepted" | "rejected") => void,
  ) {
    if (!canReview) return null;
    return (
      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <label className="block text-sm">
          <span className="mb-1 block text-muted">{ru.projectConnections.reviewReason}</span>
          <input
            className="input min-h-11 w-full"
            value={reasonFor(id)}
            onChange={(event) => setReason(id, event.target.value)}
            maxLength={512}
            aria-label={ru.projectConnections.reviewReason}
          />
        </label>
        <button
          type="button"
          className="btn-primary min-h-11"
          disabled={pending !== null}
          onClick={() => onReview("accepted")}
        >
          {pending === id ? ru.integrations.actionPending : ru.projectConnections.reviewAccept}
        </button>
        <button
          type="button"
          className="btn-ghost min-h-11"
          disabled={pending !== null}
          onClick={() => onReview("rejected")}
        >
          {ru.projectConnections.reviewReject}
        </button>
      </div>
    );
  }

  return (
    <section className="space-y-5" aria-busy={pending !== null}>
      <div>
        <h1 className="font-display text-3xl font-semibold">{ru.projectConnections.inbox}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{ru.projectConnections.inboxHint}</p>
      </div>
      {error && (
        <p className="border-y border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      {total === 0 ? (
        <p className="border-y border-line py-5 text-sm text-muted">{ru.projectConnections.noCandidates}</p>
      ) : (
        <div className="divide-y divide-line border-y border-line bg-white">
          {importCandidates.map((candidate) => {
            const canReview = candidate.status === "candidate" || candidate.status === "reviewing";
            const provenance = candidate.provenance;
            return (
              <article key={candidate.candidateId} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{importSourceLabel(candidate.sourceKind)}</span>
                  <span className="text-xs text-muted">{candidateStatusLabel(candidate.status)}</span>
                </div>
                <p className="mt-1 text-sm text-muted">
                  {ru.projectConnections.scanState}: {scanStateLabel(candidate.scanState)}
                  {candidate.serverSha256 ? ` · ${candidate.serverSha256.slice(0, 12)}…` : ""}
                </p>
                {(provenance.providerCode
                  || provenance.exactExternalRevision
                  || provenance.selectionMode) && (
                  <details className="mt-3 border-t border-line pt-3 text-sm">
                    <summary className="cursor-pointer font-medium">
                      {ru.projectConnections.provenance}
                    </summary>
                    <dl className="mt-2 grid gap-1 text-muted sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-3">
                      {provenance.providerCode && (
                        <>
                          <dt>{ru.projectConnections.provider}</dt>
                          <dd>{importProviderLabel(provenance.providerCode)}</dd>
                        </>
                      )}
                      {provenance.exactExternalRevision && (
                        <>
                          <dt>{ru.projectConnections.exactRevision}</dt>
                          <dd className="break-all">{provenance.exactExternalRevision}</dd>
                        </>
                      )}
                      {provenance.selectionMode && (
                        <>
                          <dt>{ru.projectConnections.selectionMode}</dt>
                          <dd>{ru.projectConnections.explicitSelectedObject}</dd>
                        </>
                      )}
                    </dl>
                  </details>
                )}
                {canReview && (
                  <label className="mt-3 block max-w-sm text-sm">
                    <span className="mb-1 block text-muted">{ru.projectConnections.targetKind}</span>
                    <select
                      className="input min-h-11 w-full"
                      value={targetKindFor(candidate)}
                      onChange={(event) => setTargetKind(
                        candidate.candidateId,
                        event.target.value as ImportCandidateProjection["targetKind"],
                      )}
                      aria-label={ru.projectConnections.targetKind}
                    >
                      {(Object.keys(ru.projectConnections.targetKinds) as ImportCandidateProjection["targetKind"][]).map(
                        (targetKind) => (
                          <option key={targetKind} value={targetKind}>
                            {importTargetLabel(targetKind)}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                )}
                {reviewControls(
                  candidate.candidateId,
                  canReview,
                  (decision) => void reviewImportCandidate(candidate, decision),
                )}
              </article>
            );
          })}
          {telegramCandidates.map((candidate) => {
            const canReview = candidate.status === "candidate";
            return (
              <article key={candidate.candidateId} className="px-4 py-4 sm:px-5">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{telegramSourceLabel(candidate.sourceKind)}</span>
                  <span className="text-xs text-muted">{telegramStatusLabel(candidate.status)}</span>
                </div>
                {candidate.displayName && <p className="mt-1 text-sm text-muted">{candidate.displayName}</p>}
                {reviewControls(
                  candidate.candidateId,
                  canReview,
                  (decision) => void reviewTelegramCandidate(candidate, decision),
                )}
              </article>
            );
          })}
          {files.map((file) => (
            <article key={file.intakeId} className="px-4 py-4 sm:px-5">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{file.originalFilename}</span>
                <span className="text-xs text-muted">{fileStatusLabel(file.status)}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{file.mediaType} · {file.sizeBytes.toLocaleString("ru-RU")} {ru.projectConnections.bytes}</p>
              {file.status === "clean" && reviewControls(
                file.intakeId,
                true,
                (decision) => void reviewFileIntake(file, decision),
              )}
              {file.status === "ingested_candidate" && (
                <div className="mt-3">
                  <button
                    type="button"
                    className="btn-primary min-h-11"
                    disabled={pending !== null}
                    onClick={() => void publishFileIntake(file)}
                  >
                    {pending === file.intakeId
                      ? ru.integrations.actionPending
                      : ru.projectConnections.publishInternalCopy}
                  </button>
                </div>
              )}
            </article>
          ))}
          {links.map((link) => (
            <article key={link.linkId} className="px-4 py-4 sm:px-5">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="font-medium">{link.title}</span>
                <span className="text-xs text-muted">{linkVisibilityLabel(link.visibility)}</span>
              </div>
              <p className="mt-1 text-sm text-muted">{link.domain}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
