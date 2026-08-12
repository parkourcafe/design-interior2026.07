"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import type {
  ProjectCeoOperationState,
  ProjectCeoRole,
  ProjectCeoTab,
  ProjectWorkspaceView,
  PhotoMilestoneView,
  ParticipantView,
  ReleaseSummary,
  SourceRegistryItem,
  UiScenario,
} from "./contracts";
import { Badge, Metric } from "./badges";
import { CopyLinkButton } from "./copy-link-button";
import { can, visibleTabsForRole } from "./role-policy";
import { ScenarioPanel, ScenarioSwitcher } from "./state-panel";
import { ProjectCeoCommandButton, sendProjectCeoCommand } from "./command-client";
import { PROJECTCEO_COMMAND_CONTRACT_VERSION } from "@/lib/project-intelligence/delivery/projectceo/command-contract";
import { recordIdFromContent } from "./record-id";
import { M2WorkflowPanel } from "./m2-workflow-panel";
import { M2ClientReviewPanel } from "./m2-client-review-panel";
import { M2M3ApprovedInputCard } from "./m2-m3-approved-input-card";
import { TelegramChannelPanel } from "./telegram-channel-panel";
import { TelegramInboxPanel } from "./telegram-inbox-panel";

const projectCeoRu = ru.projectCeo;

function formatDate(value: string | null): string {
  if (!value) return projectCeoRu.common.dash;
  return new Intl.DateTimeFormat(projectCeoRu.common.locale, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function shortHash(value: string | null): string {
  if (!value) return projectCeoRu.common.dash;
  return `${value.slice(0, 15)}…${value.slice(-8)}`;
}

/**
 * The stated reason for a closed action, in words a person can act on. Shared
 * because it is needed in several places, and saying "unavailable" where the
 * truth is "this part of the module is not open yet" is a refusal without a
 * reason — repeated in three places instead of one.
 */
function operationReason(operation: ProjectCeoOperationState): string {
  if (operation.status === "available") return "";
  if (operation.reason === "increment_not_authorized") {
    return projectCeoRu.common.incrementNotAuthorized;
  }
  if (operation.reason === "module_disabled") {
    return projectCeoRu.workspace.sources.moduleDisabled;
  }
  return projectCeoRu.common.commandUnavailable;
}

function sourceTone(source: SourceRegistryItem) {
  if (source.quarantine) return "danger" as const;
  if (source.reviewStatus === "pending") return "warning" as const;
  if (source.reviewStatus === "confirmed") return "success" as const;
  return "neutral" as const;
}

function milestoneReadyForAcceptance(milestone: PhotoMilestoneView): boolean {
  const photos = milestone.areas.flatMap((area) => area.photos);
  return photos.length > 0 && photos.every((photo) => photo.decision === "accepted");
}

function photoSourcesForPackage(
  sources: readonly SourceRegistryItem[],
  packageId: string | null,
): readonly SourceRegistryItem[] {
  if (!packageId) return [];
  return sources.filter((source) => (
    source.packageId === packageId
    && source.mediaKind === "image"
    && source.availability === "materialized"
    && source.sourceRevisionId !== null
  ));
}

function Header({
  view,
  scenario,
  onScenario,
}: {
  readonly view: ProjectWorkspaceView;
  readonly scenario: UiScenario;
  readonly onScenario: (scenario: UiScenario) => void;
}) {
  const role = view.actor.role;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <Link href="/dashboard/projectceo" className="hover:text-accent">
          {projectCeoRu.appName}
        </Link>
        <span aria-hidden="true">/</span>
        <span>{view.project.name}</span>
      </div>
      <section className="mt-4 overflow-hidden rounded-3xl bg-coal p-5 text-ivory shadow-xl sm:p-7">
        <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="accent">
                {view.actor.packageId
                  ? projectCeoRu.common.exactWorkPackage
                  : projectCeoRu.workspace.header.fullProjectArea(
                      view.project.areaM2 > 0
                        ? view.project.areaM2.toLocaleString(projectCeoRu.common.locale)
                        : projectCeoRu.common.dash,
                    )}
              </Badge>
              <Badge tone="success">{projectCeoRu.workspace.header.baselineVersion(view.baseline.versionNo)}</Badge>
              <Badge tone="warning">{projectCeoRu.workspace.header.changeCount(view.project.openChangeCount)}</Badge>
            </div>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-none sm:text-5xl">
              {view.project.name}
            </h1>
            <p className="mt-3 text-sm leading-6 text-ivorymuted">
              {projectCeoRu.workspace.header.graphLead(view.project.packageCount)}
            </p>
          </div>
          <div className="rounded-2xl border border-linedark bg-white/5 p-4 text-sm">
            <p className="text-xs text-ivorymuted">{projectCeoRu.common.exactScope}</p>
            <p className="mt-1 font-medium">
              {view.actor.packageId
                ? view.packages.find((item) => item.id === view.actor.packageId)?.name ?? projectCeoRu.common.workPackage
                : projectCeoRu.common.allProject}
            </p>
            <p className="mt-2 text-xs text-ivorymuted">
              {projectCeoRu.common.role}: {projectCeoRu.roles[role]}
            </p>
          </div>
        </div>
      </section>

      <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:items-end">
        <div className="flex-1 text-xs text-muted sm:max-w-64">
          <p>{projectCeoRu.common.role}</p>
          <p className="mt-1 text-sm font-medium text-ink">{projectCeoRu.roles[role]}</p>
        </div>
        <ScenarioSwitcher value={scenario} onChange={onScenario} />
        <div className="flex-1 text-xs text-muted sm:text-right">
          <p className="font-medium text-ink">{view.actor.displayName}</p>
          <p>{projectCeoRu.common.serverScopedCapabilities(view.actor.capabilities.length)}</p>
        </div>
      </div>
    </>
  );
}

function PhotoEvidenceForm({ view }: { readonly view: ProjectWorkspaceView }) {
  const router = useRouter();
  const targets = view.milestones.flatMap((milestone) => milestone.areas.map((area) => ({
    milestoneId: milestone.id,
    packageId: milestone.packageId,
    milestoneLabel: milestone.milestone,
    areaNodeId: area.areaNodeId,
  })));
  const initialTarget = targets[0] ?? null;
  const [targetKey, setTargetKey] = useState(
    initialTarget ? `${initialTarget.milestoneId}\0${initialTarget.areaNodeId}` : "",
  );
  const [sourceId, setSourceId] = useState(
    photoSourcesForPackage(view.sources, initialTarget?.packageId ?? null)[0]?.id ?? "",
  );
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const retry = useRef<{
    readonly fingerprint: string;
    readonly commandId: string;
    readonly capturedAt: string;
  } | null>(null);
  const available = view.operations.upload_photo_evidence.status === "available";
  const selectedTarget = targets.find((item) => (
    `${item.milestoneId}\0${item.areaNodeId}` === targetKey
  )) ?? null;
  const sources = photoSourcesForPackage(view.sources, selectedTarget?.packageId ?? null);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const target = selectedTarget;
    const source = sources.find((item) => item.id === sourceId);
    if (!available || !target || !source?.sourceRevisionId || state === "pending") return;
    const fingerprint = `${targetKey}\0${source.id}\0${note.trim()}`;
    if (!retry.current || retry.current.fingerprint !== fingerprint) {
      retry.current = {
        fingerprint,
        commandId: crypto.randomUUID(),
        capturedAt: new Date().toISOString(),
      };
    }
    setState("pending");
    try {
      const response = await sendProjectCeoCommand({
        contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
        kind: "upload_photo_evidence",
        projectId: view.project.id,
        payload: {
          milestoneId: target.milestoneId,
          areaNodeId: target.areaNodeId,
          sourceId: source.id,
          sourceRevisionId: source.sourceRevisionId,
          capturedAt: retry.current.capturedAt,
          note: note.trim() || null,
        },
      }, retry.current.commandId);
      if (response.status !== "completed") {
        setState("error");
        return;
      }
      retry.current = null;
      setNote("");
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3 rounded-xl border border-line p-4">
      <p className="text-xs font-medium text-muted">{projectCeoRu.workspace.overview.photoEvidenceForm}</p>
      <label className="block text-xs text-muted">
        {projectCeoRu.workspace.overview.milestoneArea}
        <select
          value={targetKey}
          onChange={(event) => {
            const nextKey = event.target.value;
            const nextTarget = targets.find((item) => (
              `${item.milestoneId}\0${item.areaNodeId}` === nextKey
            )) ?? null;
            setTargetKey(nextKey);
            setSourceId(
              photoSourcesForPackage(view.sources, nextTarget?.packageId ?? null)[0]?.id ?? "",
            );
          }}
          disabled={!available || targets.length === 0 || state === "pending"}
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink"
        >
          {targets.length === 0 && <option value="">{projectCeoRu.common.unavailable}</option>}
          {targets.map((target) => (
            <option key={`${target.milestoneId}:${target.areaNodeId}`} value={`${target.milestoneId}\0${target.areaNodeId}`}>
              {target.milestoneLabel} · {target.areaNodeId}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted">
        {projectCeoRu.workspace.overview.photoSource}
        <select
          value={sourceId}
          onChange={(event) => setSourceId(event.target.value)}
          disabled={!available || sources.length === 0 || state === "pending"}
          className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink"
        >
          {sources.length === 0 && <option value="">{projectCeoRu.workspace.overview.noPhotoSource}</option>}
          {sources.map((source) => (
            <option key={source.id} value={source.id}>{source.displayCode} · {source.zone}</option>
          ))}
        </select>
      </label>
      <label className="block text-xs text-muted">
        {projectCeoRu.workspace.overview.photoNote}
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={2000}
          disabled={!available || state === "pending"}
          className="mt-1 min-h-10 w-full rounded-lg border border-line px-3 text-sm text-ink"
        />
      </label>
      <button
        type="submit"
        disabled={!available || !targetKey || !sourceId || state === "pending"}
        className="btn-ghost w-full"
      >
        {state === "pending" ? projectCeoRu.actions.refresh : projectCeoRu.actions.addPhoto}
      </button>
      {state === "error" && (
        <p role="status" className="text-xs text-red-700">{projectCeoRu.common.commandUnavailable}</p>
      )}
    </form>
  );
}

function OverviewView({
  view,
  role,
}: {
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
}) {
  const mayUploadPhoto = can(role, "upload_photo_evidence");
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label={projectCeoRu.workspace.overview.physical} value={view.project.sourceStats.physicalRecords} hint={projectCeoRu.workspace.overview.physicalHint} />
        <Metric label={projectCeoRu.workspace.overview.materialized} value={view.project.sourceStats.materializedRecords} hint={projectCeoRu.workspace.overview.materializedHint} />
        <Metric label={projectCeoRu.workspace.overview.placeholders} value={view.project.sourceStats.placeholders} hint={projectCeoRu.workspace.overview.placeholdersHint} />
        <Metric label={projectCeoRu.workspace.overview.reviewQueue} value={view.project.sourceStats.reviewQueue} hint={projectCeoRu.workspace.overview.reviewQueueHint} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.overview.projectState}</p>
              <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.overview.baselineRelease}</h2>
            </div>
            <Badge tone={view.baseline.status === "published" ? "success" : "warning"}>
              {view.baseline.status}
            </Badge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-paper p-3">
              <dt className="text-xs text-muted">{projectCeoRu.portfolio.baseline}</dt>
              <dd className="mt-1 font-medium">V{view.baseline.versionNo}</dd>
            </div>
            <div className="rounded-xl bg-paper p-3">
              <dt className="text-xs text-muted">{projectCeoRu.workspace.overview.latestRelease}</dt>
              <dd className="mt-1 font-medium">V{view.project.latestRelease?.versionNo ?? projectCeoRu.common.dash}</dd>
            </div>
            <div className="col-span-2 rounded-xl bg-paper p-3">
              <dt className="text-xs text-muted">{projectCeoRu.workspace.overview.semanticHash}</dt>
              <dd className="mt-1 break-all font-mono text-xs">{shortHash(view.baseline.semanticHash)}</dd>
            </div>
          </dl>

          {/*
            Baseline publication (A'). The button sends only the snapshot token
            from the projection: the server derives the composition, and it
            cannot be picked by hand — otherwise the completeness rule could be
            bypassed around the screen. The token is what makes the confirmation
            honest: if the project state moved between the preview and the
            click, the command answers stale_state instead of publishing
            something other than what the person saw.
          */}
          {view.operations.publish_baseline.status === "available"
            && view.operations.publish_baseline.commandTargetId ? (
              <div className="mt-4 space-y-2">
                <ProjectCeoCommandButton
                  command={{
                    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                    kind: "publish_baseline",
                    projectId: view.project.id,
                    payload: {
                      snapshotToken: view.operations.publish_baseline.commandTargetId,
                    },
                  }}
                  className="btn-primary w-full"
                  confirmation={projectCeoRu.workspace.overview.publishBaselineConfirm}
                >
                  {projectCeoRu.workspace.overview.publishBaseline}
                </ProjectCeoCommandButton>
                <p className="text-xs text-muted">
                  {projectCeoRu.workspace.overview.publishBaselineHint}
                </p>
              </div>
            ) : view.operations.publish_baseline.status === "unavailable"
              && view.operations.publish_baseline.reason === "prerequisite_missing" ? (
                <p className="mt-4 text-xs text-muted">
                  {projectCeoRu.workspace.overview.publishBaselineNothing}
                </p>
              ) : null}

          {/*
            Release publication — the same A' shape one step later. The package
            version expresses the published baseline in full, so there is no
            composition to choose here either: the button carries the snapshot
            token and nothing else, and a state that moved between the preview
            and the click is refused rather than published.
          */}
          {view.operations.publish_release.status === "available"
            && view.operations.publish_release.commandTargetId ? (
              <div className="mt-4 space-y-2 border-t border-line pt-4">
                <ProjectCeoCommandButton
                  command={{
                    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                    kind: "publish_release",
                    projectId: view.project.id,
                    payload: {
                      snapshotToken: view.operations.publish_release.commandTargetId,
                    },
                  }}
                  className="btn-primary w-full"
                  confirmation={projectCeoRu.workspace.overview.publishReleaseConfirm}
                >
                  {projectCeoRu.workspace.overview.publishRelease}
                </ProjectCeoCommandButton>
                <p className="text-xs text-muted">
                  {projectCeoRu.workspace.overview.publishReleaseHint}
                </p>
              </div>
            ) : view.operations.publish_release.status === "unavailable"
              && view.operations.publish_release.reason === "prerequisite_missing" ? (
                <p className="mt-4 border-t border-line pt-4 text-xs text-muted">
                  {projectCeoRu.workspace.overview.publishReleaseNothing}
                </p>
              ) : null}
        </section>

        <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.overview.m4Thin}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.overview.executionHandover}</h2>
          <div className="mt-4 space-y-3">
            {view.milestones.map((milestone) => (
              <div key={milestone.id} className="rounded-xl bg-paper p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                  <p className="text-sm font-medium">{milestone.milestone}</p>
                  <p className="mt-0.5 text-xs text-muted">{milestone.area} · {projectCeoRu.workspace.overview.photoCount(milestone.photoCount)}</p>
                  </div>
                  <Badge tone={milestone.status === "accepted" ? "success" : "warning"}>
                    {milestone.status === "accepted"
                      ? projectCeoRu.workspace.overview.accepted
                      : projectCeoRu.workspace.overview.review}
                  </Badge>
                </div>
                {can(role, "review_milestone") && milestone.status !== "accepted" && (
                  <div className="mt-3 space-y-2 border-t border-line pt-3">
                    {milestone.areas.flatMap((area) => area.photos).filter((photo) => photo.decision === null).map((photo) => (
                      <div key={photo.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 text-muted">{projectCeoRu.workspace.overview.photoCaptured(formatDate(photo.capturedAt))}</span>
                        <ProjectCeoCommandButton
                          command={{
                            contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                            kind: "review_photo_evidence",
                            projectId: view.project.id,
                            payload: {
                              photoEvidenceId: photo.id,
                              decision: "accepted",
                              reason: projectCeoRu.workspace.overview.photoAcceptedReason,
                            },
                          }}
                          disabled={view.operations.review_photo_evidence.status !== "available"}
                          className="rounded-lg border border-emerald-200 px-3 py-2 text-xs font-medium text-emerald-700"
                        >
                          {projectCeoRu.actions.approve}
                        </ProjectCeoCommandButton>
                        <ProjectCeoCommandButton
                          command={{
                            contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                            kind: "review_photo_evidence",
                            projectId: view.project.id,
                            payload: {
                              photoEvidenceId: photo.id,
                              decision: "rejected",
                              reason: projectCeoRu.workspace.overview.photoRejectedReason,
                            },
                          }}
                          disabled={view.operations.review_photo_evidence.status !== "available"}
                          className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700"
                        >
                          {projectCeoRu.actions.reject}
                        </ProjectCeoCommandButton>
                      </div>
                    ))}
                    {milestone.photoCount > 0 && (
                      <ProjectCeoCommandButton
                        command={{
                          contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                          kind: "accept_milestone",
                          projectId: view.project.id,
                          payload: { milestoneId: milestone.id },
                        }}
                        disabled={
                          view.operations.accept_milestone.status !== "available"
                          || !milestoneReadyForAcceptance(milestone)
                        }
                        className="btn-primary w-full"
                        confirmation={projectCeoRu.workspace.overview.acceptMilestoneConfirm}
                      >
                        {projectCeoRu.workspace.overview.acceptMilestone}
                      </ProjectCeoCommandButton>
                    )}
                  </div>
                )}
              </div>
            ))}
            {view.milestones.length === 0 && (
              <p className="rounded-xl bg-paper p-4 text-sm text-muted">{projectCeoRu.workspace.overview.noFieldEvidence}</p>
            )}
          </div>
          {mayUploadPhoto && <PhotoEvidenceForm view={view} />}
          {mayUploadPhoto && view.operations.upload_photo_evidence.status !== "available" && (
            <p className="mt-2 text-xs text-muted">
              {operationReason(view.operations.upload_photo_evidence)}
            </p>
          )}
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.overview.handoverArchive}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.overview.handoverReadiness}</h2>
            <p className="mt-2 text-sm text-muted">
              {projectCeoRu.workspace.overview.handoverSummary(
                view.handover.acceptedAreaCount,
                view.handover.totalAreaCount,
                view.handover.warrantyDocumentCount,
              )}
            </p>
          </div>
          <Badge tone={view.handover.status === "archived" ? "success" : "warning"}>
            {view.handover.status}
          </Badge>
        </div>
        <div className="mt-4 h-2 rounded-full bg-line">
          <div
            className="h-2 rounded-full bg-accent"
            style={{
              width: `${Math.round(
                view.handover.acceptedAreaCount
                / Math.max(view.handover.totalAreaCount, 1)
                * 100,
              )}%`,
            }}
          />
        </div>
        <p className="mt-3 font-mono text-xs text-muted">
          {view.handover.archiveHash ?? projectCeoRu.workspace.overview.noArchiveHash}
        </p>
      </section>
    </div>
  );
}

/**
 * Intake: a human declares a document that is expected in the package.
 *
 * The browser registers a placeholder only — a name and its place in the
 * hierarchy. Materialisation (file, size, checksum) travels the ingestion
 * path, so this form never pretends to carry one: the RPC would reject a
 * placeholder that arrived with those fields anyway.
 */
function SourceIntakeForm({
  view,
}: {
  readonly view: ProjectWorkspaceView;
}) {
  const operation = view.operations.register_source;
  const packages = view.packages.filter((item) => item.status === "active");
  const [name, setName] = useState("");
  const [packageId, setPackageId] = useState(packages[0]?.id ?? "");
  // The package list has a life of its own (router.refresh after commands):
  // a selection that is no longer in the list must not silently travel in the
  // payload.
  const effectivePackageId = packages.some((item) => item.id === packageId)
    ? packageId
    : packages[0]?.id ?? "";
  const [floor, setFloor] = useState("");
  const [zone, setZone] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [documentStatus, setDocumentStatus] = useState<"current" | "previous" | "reference" | "unknown">("current");

  const complete = Boolean(
    name.trim() && effectivePackageId && floor.trim() && zone.trim() && discipline.trim(),
  );
  // The record id is derived from the content, so the same declared document
  // keeps the same identity across remounts and repeated presses. A random id
  // would quietly create a second physical record for the same paper. The
  // derivation is pure and cheap, so it runs on render — no memo to fight the
  // compiler over.
  const physicalRecordId = recordIdFromContent(
    [name, effectivePackageId, floor, zone, discipline, documentStatus],
  );

  if (operation.status !== "available") {
    // The stated reason must be the real one: "your role cannot" shown to an
    // owner in the read-only fixture would be a lie about the role.
    return (
      <p className="mt-3 text-xs text-muted">
        {operation.reason === "module_disabled"
          ? projectCeoRu.workspace.sources.moduleDisabled
          : operation.reason === "capability_missing"
            ? projectCeoRu.workspace.sources.noRegisterCapability
            : projectCeoRu.common.commandUnavailable}
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-line/70 p-3">
      <p className="text-sm font-medium">{projectCeoRu.workspace.sources.registerTitle}</p>
      <p className="mt-1 text-xs text-muted">{projectCeoRu.workspace.sources.registerHint}</p>
      <div className="mt-3 grid gap-2">
        <label className="text-xs text-muted">
          {projectCeoRu.workspace.sources.registerName}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={projectCeoRu.workspace.sources.registerNamePlaceholder}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-muted">
          {projectCeoRu.workspace.sources.registerPackage}
          <select
            value={effectivePackageId}
            onChange={(event) => setPackageId(event.target.value)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink"
          >
            {packages.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs text-muted">
            {projectCeoRu.workspace.sources.registerFloor}
            <input
              value={floor}
              onChange={(event) => setFloor(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-muted">
            {projectCeoRu.workspace.sources.registerZone}
            <input
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-muted">
            {projectCeoRu.workspace.sources.registerDiscipline}
            <input
              value={discipline}
              onChange={(event) => setDiscipline(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink"
            />
          </label>
        </div>
        <label className="text-xs text-muted">
          {projectCeoRu.workspace.sources.registerStatus}
          <select
            value={documentStatus}
            onChange={(event) => setDocumentStatus(event.target.value as typeof documentStatus)}
            className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink"
          >
            {(["current", "previous", "reference", "unknown"] as const).map((status) => (
              <option key={status} value={status}>
                {projectCeoRu.workspace.sources.documentStatusOptions[status]}
              </option>
            ))}
          </select>
        </label>
        <ProjectCeoCommandButton
          disabled={!complete}
          command={{
            contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
            kind: "register_source" as const,
            projectId: view.project.id,
            payload: {
              packageId: effectivePackageId,
              physicalRecordId,
              sanitizedName: name.trim(),
              floorId: floor.trim(),
              zoneId: zone.trim(),
              disciplineId: discipline.trim(),
              availability: "placeholder" as const,
              documentStatus,
              sizeBytes: null,
              checksum: null,
              sourceRevisionId: null,
              semanticConflict: false,
            },
          }}
        >
          {projectCeoRu.workspace.sources.register}
        </ProjectCeoCommandButton>
        {!complete && (
          <p className="text-xs text-muted">{projectCeoRu.workspace.sources.registerIncomplete}</p>
        )}
      </div>
    </div>
  );
}

/**
 * A human decision on a source revision.
 *
 * The button is offered exactly when the server would accept it: the operation
 * state is server-derived (`view.operations.review_source`) and the target
 * comes from the card itself. An unavailable control always states why —
 * "disabled" without a reason reads as breakage.
 */
function SourceReviewControls({
  view,
  role,
  source,
}: {
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
  readonly source: SourceRegistryItem;
}) {
  const operation = view.operations.review_source;
  const target = source.reviewTargetRevisionId;
  const decided = source.reviewStatus === "confirmed" || source.reviewStatus === "rejected";
  const available = operation.status === "available" && target !== null && !decided;

  const reason = operation.status === "unavailable"
    ? operation.reason === "module_disabled"
      ? projectCeoRu.workspace.sources.moduleDisabled
      : operation.reason === "capability_missing"
        ? can(role, "review_source")
          ? projectCeoRu.workspace.sources.noReviewClaimCapability
          : projectCeoRu.workspace.sources.noReviewCapability
        : projectCeoRu.common.commandUnavailable
    : target === null
      ? projectCeoRu.workspace.sources.noReviewTarget
      : decided
        ? projectCeoRu.workspace.sources.alreadyDecided
        : null;

  const command = (decision: "confirmed" | "rejected") => ({
    contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
    kind: "review_source" as const,
    projectId: view.project.id,
    payload: {
      targetRevisionId: target ?? "",
      expectedRevisionId: target ?? "",
      decision,
    },
  });

  return (
    <>
      <div className="mt-5 grid gap-2">
        <ProjectCeoCommandButton command={command("confirmed")} disabled={!available}>
          {projectCeoRu.actions.confirmSource}
        </ProjectCeoCommandButton>
        {/* The server has no "clarification" decision: its vocabulary is
            confirmed or rejected. The control stays honestly disabled instead
            of faking a third path. */}
        <button type="button" disabled className="btn-ghost">
          {projectCeoRu.actions.clarification}
        </button>
        <ProjectCeoCommandButton
          command={command("rejected")}
          disabled={!available}
          className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-40"
          confirmation={projectCeoRu.workspace.sources.rejectConfirmation}
        >
          {projectCeoRu.actions.reject}
        </ProjectCeoCommandButton>
      </div>
      <p className="mt-3 text-xs text-muted">
        {reason ?? projectCeoRu.workspace.sources.clarificationNotBuilt}
      </p>
    </>
  );
}

function SourcesView({
  view,
  role,
}: {
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
}) {
  const [query, setQuery] = useState("");
  const [availability, setAvailability] = useState<"all" | SourceRegistryItem["availability"]>("all");
  const [selectedId, setSelectedId] = useState(view.sources[0]?.id ?? "");
  const filtered = useMemo(() => view.sources.filter((source) => (
    (availability === "all" || source.availability === availability)
    && (
      !query.trim()
      || `${source.displayCode} ${source.floor} ${source.zone} ${source.discipline}`
        .toLocaleLowerCase("ru-RU")
        .includes(query.trim().toLocaleLowerCase("ru-RU"))
    )
  )), [availability, query, view.sources]);
  const selected = view.sources.find((source) => source.id === selectedId) ?? filtered[0] ?? null;

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_21rem]">
      <section className="min-w-0 rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 text-xs text-muted">
            {projectCeoRu.workspace.sources.search}
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={projectCeoRu.workspace.sources.searchPlaceholder}
              className="mt-1 min-h-11 w-full rounded-lg border border-line px-3 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
            />
          </label>
          <label className="text-xs text-muted">
            {projectCeoRu.workspace.sources.availability}
            <select
              value={availability}
              onChange={(event) => setAvailability(event.target.value as typeof availability)}
              className="mt-1 min-h-11 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink"
            >
              <option value="all">{projectCeoRu.workspace.sources.all}</option>
              <option value="materialized">{projectCeoRu.workspace.sources.materialized}</option>
              <option value="placeholder">{projectCeoRu.workspace.sources.placeholders}</option>
            </select>
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <Badge tone="neutral">{projectCeoRu.workspace.sources.shown(filtered.length)}</Badge>
          <Badge tone="success">{projectCeoRu.common.hiddenFilenames}</Badge>
          <Badge tone="warning">{projectCeoRu.common.aiDoesNotApprove}</Badge>
        </div>

        <div className="mt-4 max-h-[36rem] overflow-auto rounded-xl border border-line">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="sticky top-0 bg-paper text-xs text-muted">
              <tr>
                <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.sources.code}</th>
                <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.sources.context}</th>
                <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.sources.availabilityColumn}</th>
                <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.sources.provenance}</th>
                <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.sources.review}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((source) => {
                const reviewStatus = source.reviewStatus;
                return (
                  <tr
                    key={source.id}
                    className={`cursor-pointer border-t border-line hover:bg-orange-50/40 ${
                      selected?.id === source.id ? "bg-orange-50/70" : ""
                    }`}
                    onClick={() => setSelectedId(source.id)}
                  >
                    <td className="px-3 py-3 font-mono text-xs">{source.displayCode}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{source.discipline}</p>
                      <p className="mt-0.5 text-xs text-muted">{source.floor} · {source.zone}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={source.availability === "materialized" ? "success" : "neutral"}>
                        {source.availability}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted">
                      {source.checksumShort ?? projectCeoRu.workspace.sources.missingChecksum}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={sourceTone({ ...source, reviewStatus })}>{reviewStatus}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.sources.sourceDetail}</p>
        {selected ? (
          <>
            <div className="mt-2 flex items-center justify-between gap-3">
              <h2 className="font-display text-2xl font-semibold">{selected.displayCode}</h2>
              <Badge tone={sourceTone(selected)}>{selected.reviewStatus}</Badge>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted">{projectCeoRu.workspace.sources.hierarchy}</dt>
                <dd className="mt-1">{selected.floor} → {selected.zone} → {selected.discipline}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{projectCeoRu.workspace.sources.documentStatus}</dt>
                <dd className="mt-1">{selected.documentStatus}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{projectCeoRu.workspace.sources.checksum}</dt>
                <dd className="mt-1 font-mono text-xs">{selected.checksumShort ?? projectCeoRu.workspace.sources.noPlaceholderChecksum}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{projectCeoRu.workspace.sources.duplicateAliases}</dt>
                <dd className="mt-1">{selected.duplicateAliasCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">{projectCeoRu.workspace.sources.quarantine}</dt>
                <dd className="mt-1">{selected.quarantine ?? projectCeoRu.common.none}</dd>
              </div>
            </dl>
            <SourceReviewControls
              view={view}
              role={role}
              source={selected}
            />
            <SourceIntakeForm view={view} />
          </>
        ) : (
          <>
            <p className="mt-3 text-sm text-muted">{projectCeoRu.workspace.sources.notSelected}</p>
            <SourceIntakeForm view={view} />
          </>
        )}
      </aside>
    </div>
  );
}

function DecisionsView({
  view,
  role,
}: {
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
}) {
  const selectionStatus = view.selections[0]?.reviewStatus ?? "draft";
  const mayReview = can(role, "review_selection");
  const mayCreate = can(role, "create_selection");

  return (
    <>
    {view.actor.role === "client"
      ? <M2ClientReviewPanel view={view} />
      : (view.actor.role === "owner" || view.actor.role === "architect")
        ? <><M2WorkflowPanel view={view} /><M2M3ApprovedInputCard view={view} /></>
        : null}
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.decisions.exactRevisions}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.decisions.decisions}</h2>
          </div>
          {mayCreate && <button type="button" disabled className="btn-ghost text-xs">{projectCeoRu.actions.createDecision}</button>}
        </div>
        <div className="mt-4 space-y-3">
          {view.decisions.map((decision) => (
            <article key={decision.revisionId} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={decision.reviewStatus === "approved" ? "success" : "warning"}>
                  {decision.reviewStatus}
                </Badge>
                <Badge tone="neutral">{projectCeoRu.workspace.decisions.revision} {decision.revisionNo}</Badge>
                <Badge tone={decision.claimStatus === "human_origin" ? "success" : "warning"}>
                  {decision.claimStatus}
                </Badge>
              </div>
              <h3 className="mt-3 text-sm font-semibold">{decision.title}</h3>
              <p className="mt-1 text-sm leading-6 text-muted">{decision.resolution}</p>
              <div className="mt-3 rounded-lg bg-paper p-3 text-xs">
                <p className="font-medium">{projectCeoRu.workspace.decisions.evidence}</p>
                {decision.evidence.map((item) => (
                  <p key={item.evidenceId} className="mt-1 text-muted">
                    {item.sourceCode} · {item.sourceRevision} · {item.locatorLabel}
                  </p>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.decisions.selectionApproval}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.decisions.materials}</h2>
          </div>
          <Badge tone={selectionStatus === "approved" ? "success" : selectionStatus === "rejected" ? "danger" : "warning"}>
            {selectionStatus}
          </Badge>
        </div>
        {view.selections.map((selection) => (
          <article key={selection.revisionId} className="mt-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">{projectCeoRu.workspace.decisions.revision} {selection.revisionNo}</Badge>
              <Badge tone="neutral">{selection.area}</Badge>
            </div>
            <h3 className="mt-3 text-lg font-semibold">{selection.title}</h3>
            <dl className="mt-3 grid grid-cols-2 gap-2">
              {selection.specification.map((item) => (
                <div key={item.label} className="rounded-lg bg-paper p-3">
                  <dt className="text-[11px] text-muted">{item.label}</dt>
                  <dd className="mt-1 text-sm font-medium">{item.value}</dd>
                </div>
              ))}
            </dl>
            {selection.priceObservation && (
              <div className="mt-3 rounded-xl border border-line p-4">
                <p className="text-xs text-muted">{projectCeoRu.workspace.decisions.checkedPrice}</p>
                <p className="mt-1 font-display text-2xl font-semibold">
                  {selection.priceObservation.amountRub.toLocaleString("ru-RU")} ₽
                </p>
                <p className="mt-1 text-xs text-muted">
                  {projectCeoRu.workspace.decisions.checkedAt} {formatDate(selection.priceObservation.checkedAt)} · {selection.priceObservation.sourceCode}
                </p>
              </div>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                disabled
                className="btn-primary"
              >
                {projectCeoRu.actions.approve}
              </button>
              <button
                type="button"
                disabled
                className="btn-ghost"
              >
                {projectCeoRu.actions.change}
              </button>
              <button
                type="button"
                disabled
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-40"
              >
                {projectCeoRu.actions.reject}
              </button>
            </div>
            <p className="mt-3 text-xs text-muted">
              {!mayReview ? projectCeoRu.workspace.decisions.noReviewCapability : projectCeoRu.common.commandUnavailable}
            </p>

            <div className="mt-5 border-t border-line pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{projectCeoRu.workspace.decisions.revisionHistory}</p>
              <div className="mt-2 space-y-2">
                {selection.revisionHistory.map((revision) => (
                  <div key={revision.revisionId} className="flex items-start justify-between gap-3 rounded-lg bg-paper p-3 text-sm">
                    <div>
                      <p className="font-medium">{projectCeoRu.workspace.decisions.revision} {revision.revisionNo}</p>
                      <p className="mt-1 text-xs text-muted">{revision.reason}</p>
                    </div>
                    <Badge tone={revision.status === "current" ? "success" : "neutral"}>
                      {revision.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
        {view.selections.length === 0 && <p className="mt-4 text-sm text-muted">{projectCeoRu.workspace.decisions.noGuestSelections}</p>}
      </section>
    </div>
    </>
  );
}

function BaselineView({
  view,
  role,
}: {
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
}) {
  const published = view.baseline.status === "published";
  const mayPublish = can(role, "publish_baseline");

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.baseline.readiness}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">ProjectBaseline V{view.baseline.versionNo}</h2>
          </div>
          <Badge tone={published ? "success" : view.baseline.blockerCount ? "danger" : "warning"}>
            {published ? "published" : view.baseline.blockerCount ? "blocked" : "ready"}
          </Badge>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric label={projectCeoRu.workspace.baseline.sources} value={view.project.sourceStats.materializedRecords} />
          <Metric label={projectCeoRu.workspace.baseline.quarantine} value={view.project.sourceStats.quarantinedGroups} />
          <Metric label={projectCeoRu.workspace.baseline.blockers} value={view.baseline.blockerCount} />
          <Metric label={projectCeoRu.workspace.baseline.approval} value={projectCeoRu.workspace.baseline.human} />
        </div>
        <div className="mt-5 rounded-xl bg-paper p-4">
          <p className="text-xs text-muted">{projectCeoRu.workspace.baseline.immutableHash}</p>
          <p className="mt-2 break-all font-mono text-xs">{view.baseline.semanticHash}</p>
          <p className="mt-2 text-xs text-muted">{projectCeoRu.workspace.baseline.published} {formatDate(view.baseline.publishedAt)}</p>
        </div>
        {!published && (
          <button type="button" disabled className="btn-primary mt-5">
            {projectCeoRu.actions.publish}
          </button>
        )}
        {!published && mayPublish && (
          <p className="mt-2 text-xs text-muted">{projectCeoRu.common.commandUnavailable}</p>
        )}
      </section>

      <aside className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.baseline.diff}</p>
        <h3 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.baseline.changedRevision}</h3>
        <div className="mt-4 space-y-3 text-sm">
          <div className="rounded-xl bg-paper p-3">
            <p className="text-xs text-muted">{projectCeoRu.workspace.baseline.selection}</p>
            <p className="mt-1 font-medium">{projectCeoRu.workspace.baseline.floorFinish}</p>
            <p className="mt-1 text-xs text-muted">{projectCeoRu.workspace.baseline.revisionDelta}</p>
          </div>
          <div className="rounded-xl bg-paper p-3">
            <p className="text-xs text-muted">{projectCeoRu.workspace.baseline.impactRoots}</p>
            <p className="mt-1 font-medium">{projectCeoRu.workspace.baseline.serverDerivedOne}</p>
          </div>
          <div className="rounded-xl bg-paper p-3">
            <p className="text-xs text-muted">{projectCeoRu.workspace.baseline.immutableV1}</p>
            <p className="mt-1 font-medium text-emerald-700">{projectCeoRu.workspace.baseline.checked}</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ReleaseCard({
  release,
  role,
  projectId,
  acknowledgementAvailable,
  distributionAvailable,
  recipients,
}: {
  readonly release: ReleaseSummary;
  readonly role: ProjectCeoRole;
  readonly projectId: string;
  readonly acknowledgementAvailable: boolean;
  readonly distributionAvailable: boolean;
  readonly recipients: readonly ParticipantView[];
}) {
  const acknowledged = release.distributionStatus === "acknowledged";
  const mayAcknowledge = can(role, "acknowledge_release");
  const mayDistribute = can(role, "distribute_release");
  const router = useRouter();
  const eligibleRecipients = recipients.filter((participant) => (
    participant.status === "active"
    && participant.role !== "guest"
    && participant.role !== "owner"
  ));
  const [recipientUserId, setRecipientUserId] = useState(eligibleRecipients[0]?.id ?? "");
  const [distributionState, setDistributionState] = useState<"idle" | "pending" | "error">("idle");
  const distributionCommand = useRef({
    fingerprint: `${release.id}\0${recipientUserId}`,
    commandId: crypto.randomUUID(),
  });

  async function distribute(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!mayDistribute || !distributionAvailable || !recipientUserId || distributionState === "pending") return;
    const fingerprint = `${release.id}\0${recipientUserId}`;
    if (distributionCommand.current.fingerprint !== fingerprint) {
      distributionCommand.current = { fingerprint, commandId: crypto.randomUUID() };
    }
    setDistributionState("pending");
    try {
      const response = await sendProjectCeoCommand({
        contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
        kind: "distribute_release",
        projectId,
        payload: {
          productionPackageVersionId: release.id,
          recipientUserId,
        },
      }, distributionCommand.current.commandId);
      if (response.status !== "completed") {
        setDistributionState("error");
        return;
      }
      distributionCommand.current = { fingerprint, commandId: crypto.randomUUID() };
      setDistributionState("idle");
      router.refresh();
    } catch {
      setDistributionState("error");
    }
  }
  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-sm ${
      release.status === "superseded" ? "border-line opacity-75" : "border-orange-200"
    }`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={release.status === "current" ? "success" : "neutral"}>
              {release.status === "current"
                ? projectCeoRu.workspace.releases.current
                : projectCeoRu.workspace.releases.superseded}
            </Badge>
            <Badge tone="neutral">{projectCeoRu.workspace.releases.version} {release.versionNo}</Badge>
          </div>
          <h3 className="mt-3 text-lg font-semibold">{release.packageName}</h3>
          <p className="mt-1 text-xs text-muted">{formatDate(release.publishedAt)}</p>
        </div>
        <Badge tone={acknowledged ? "success" : "warning"}>
          {acknowledged ? projectCeoRu.workspace.releases.acknowledged : release.distributionStatus}
        </Badge>
      </div>
      <div className="mt-4 rounded-xl bg-paper p-3">
        <p className="text-xs text-muted">{projectCeoRu.workspace.releases.exactHash}</p>
        <p className="mt-1 break-all font-mono text-xs">{release.semanticHash}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">
          {release.acknowledgementCount}/{release.recipientCount} {projectCeoRu.workspace.releases.recipients}
        </span>
        {release.status === "current" && mayAcknowledge && release.pendingDistributionId && (
          <ProjectCeoCommandButton
            command={{
              contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
              kind: "acknowledge_release",
              projectId,
              payload: { distributionId: release.pendingDistributionId },
            }}
            disabled={!acknowledgementAvailable}
            className="btn-primary ml-auto"
          >
            {projectCeoRu.actions.acknowledge}
          </ProjectCeoCommandButton>
        )}
      </div>
      {release.status === "current" && mayDistribute && (
        <form onSubmit={distribute} className="mt-4 flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-xs text-muted">
            {projectCeoRu.workspace.releases.recipient}
            <select
              value={recipientUserId}
              onChange={(event) => setRecipientUserId(event.target.value)}
              disabled={!distributionAvailable || eligibleRecipients.length === 0 || distributionState === "pending"}
              className="mt-1 min-h-10 w-full rounded-lg border border-line bg-white px-3 text-sm text-ink"
            >
              {eligibleRecipients.length === 0 && (
                <option value="">{projectCeoRu.workspace.releases.noRecipients}</option>
              )}
              {eligibleRecipients.map((recipient) => (
                <option key={recipient.id} value={recipient.id}>
                  {recipient.displayName} · {projectCeoRu.roles[recipient.role]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={!distributionAvailable || !recipientUserId || distributionState === "pending"}
            className="btn-ghost"
          >
            {distributionState === "pending"
              ? projectCeoRu.actions.refresh
              : projectCeoRu.actions.distribute}
          </button>
          {distributionState === "error" && (
            <span role="status" className="text-xs text-red-700">{projectCeoRu.common.commandUnavailable}</span>
          )}
        </form>
      )}
    </article>
  );
}

function ReleasesView({
  view,
  role,
}: {
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-paper p-4 text-sm text-muted">
        {projectCeoRu.workspace.releases.exactContract}
      </section>
      {view.releases.map((release) => (
        <ReleaseCard
          key={release.id}
          release={release}
          role={role}
          projectId={view.project.id}
          acknowledgementAvailable={view.operations.acknowledge_release.status === "available"}
          distributionAvailable={view.operations.distribute_release.status === "available"}
          recipients={view.participants}
        />
      ))}
    </div>
  );
}

function ChangesView({
  view,
  role,
}: {
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [submitState, setSubmitState] = useState<"idle" | "pending" | "error">("idle");
  const commandId = useRef(crypto.randomUUID());
  const mayCreate = can(role, "create_change");
  const mayReview = can(role, "review_change_impact");
  const changeOperation = view.operations.create_change;

  async function createChange(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      !reason.trim()
      || !mayCreate
      || submitState === "pending"
      || changeOperation.status !== "available"
      || !changeOperation.commandTargetId
    ) return;
    setSubmitState("pending");
    try {
      const response = await sendProjectCeoCommand({
        contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
        kind: "create_change",
        projectId: view.project.id,
        payload: {
          reason,
          fromProductionPackageVersionId: changeOperation.commandTargetId,
          deltaCostRub: 0,
          deltaDays: 0,
        },
      }, commandId.current);
      if (response.status !== "completed") {
        setSubmitState("error");
        return;
      }
      setReason("");
      commandId.current = crypto.randomUUID();
      setSubmitState("idle");
      router.refresh();
    } catch {
      setSubmitState("error");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[0.75fr_1.25fr]">
      <form onSubmit={createChange} className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.changes.entity}</p>
        <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.changes.heading}</h2>
        <label className="mt-4 block text-xs text-muted">
          {projectCeoRu.workspace.changes.reason}
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={5}
            disabled={!mayCreate}
            placeholder={projectCeoRu.workspace.changes.reasonPlaceholder}
            className="mt-1 w-full rounded-lg border border-line p-3 text-base text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:bg-paper"
          />
        </label>
        <button
          type="submit"
          disabled={!mayCreate || !reason.trim() || submitState === "pending" || changeOperation.status !== "available"}
          className="btn-primary mt-3 w-full"
        >
          {submitState === "pending" ? projectCeoRu.actions.refresh : projectCeoRu.actions.requestChange}
        </button>
        {!mayCreate && <p className="mt-3 text-xs text-muted">{projectCeoRu.workspace.changes.noCreateCapability}</p>}
        {mayCreate && changeOperation.status !== "available" && (
          <p className="mt-3 text-xs text-muted">{operationReason(changeOperation)}</p>
        )}
        {submitState === "error" && <p className="mt-3 text-xs text-red-700">{projectCeoRu.common.commandUnavailable}</p>}
      </form>

      <section className="space-y-3">
        {view.changes.map((change) => (
          <article key={change.id} className="rounded-2xl border border-line bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <Badge tone={change.status === "released" ? "success" : "warning"}>{change.status}</Badge>
                <h3 className="mt-2 text-lg font-semibold">{change.title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{change.reason}</p>
              </div>
              <div className="shrink-0 rounded-xl bg-paper p-3 text-right">
                <p className="text-xs text-muted">{projectCeoRu.workspace.changes.delta}</p>
                <p className="mt-1 font-medium">
                  {change.deltaRub >= 0 ? "+" : ""}{change.deltaRub.toLocaleString(projectCeoRu.common.locale)} ₽
                </p>
                <p className="text-xs text-muted">
                  {change.deltaDays >= 0 ? "+" : ""}{change.deltaDays} {projectCeoRu.workspace.changes.days}
                </p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-paper p-3">
                <p className="text-muted">{projectCeoRu.workspace.changes.from}</p>
                <p className="mt-1 font-medium">{change.fromBaseline}</p>
              </div>
              <div className="rounded-lg bg-paper p-3">
                <p className="text-muted">{projectCeoRu.workspace.changes.impact}</p>
                <p className="mt-1 font-medium">{change.reviewedImpactCount}/{change.impactCount}</p>
              </div>
              <div className="rounded-lg bg-paper p-3">
                <p className="text-muted">{projectCeoRu.workspace.changes.to}</p>
                <p className="mt-1 font-medium">{change.toBaseline ?? projectCeoRu.workspace.changes.afterReview}</p>
              </div>
            </div>
            {/*
              Truncation is shown BEFORE the counter and the progress bar.
              Otherwise "8 of 8" and a full bar read as a finished review — the
              exact false status the owner's 2026-08-12 decision forbids.
            */}
            {change.impactTruncated && (
              <div className="mt-4 rounded-lg border border-line bg-paper p-3">
                <p className="text-sm font-medium">
                  {projectCeoRu.workspace.changes.truncation.title}
                </p>
                <p className="mt-1 text-xs text-muted">
                  {change.impactTruncationReason === "result_limit"
                    ? projectCeoRu.workspace.changes.truncation.resultLimit
                    : projectCeoRu.workspace.changes.truncation.depthLimit}
                </p>
                {change.impactCalculatedDepth !== null
                  && change.impactPolicyMaxDepth !== null && (
                  <p className="mt-1 text-xs text-muted">
                    {projectCeoRu.workspace.changes.truncation.depth}
                    {": "}
                    {change.impactCalculatedDepth}/{change.impactPolicyMaxDepth}
                  </p>
                )}
                {change.impactTruncationAcknowledged ? (
                  <p className="mt-2 text-xs text-muted">
                    {projectCeoRu.workspace.changes.truncation.acknowledged}
                  </p>
                ) : mayReview && change.impactRunId ? (
                  <ProjectCeoCommandButton
                    command={{
                      contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                      kind: "acknowledge_impact_truncation",
                      projectId: view.project.id,
                      payload: {
                        impactRunId: change.impactRunId,
                        reason: projectCeoRu.workspace.changes.truncation
                          .acknowledgeReason,
                      },
                    }}
                    disabled={
                      view.operations.acknowledge_impact_truncation.status
                        !== "available"
                    }
                    className="mt-2 rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent"
                  >
                    {projectCeoRu.workspace.changes.truncation.acknowledgeAction}
                  </ProjectCeoCommandButton>
                ) : null}
              </div>
            )}
            {change.impactCount > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{projectCeoRu.workspace.changes.humanDispositions}</span>
                  <span>
                    {change.reviewedImpactCount}/{change.impactCount}
                    {/* Every card handled but the run is partial: the counter
                        alone must not look like completion. */}
                    {!change.impactReviewComplete
                      && change.reviewedImpactCount === change.impactCount
                      && ` · ${projectCeoRu.workspace.changes.truncation.incomplete}`}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-line">
                  <div
                    className="h-2 rounded-full bg-accent"
                    style={{ width: `${Math.round(change.reviewedImpactCount / change.impactCount * 100)}%` }}
                  />
                </div>
                {!mayReview && <p className="mt-2 text-xs text-muted">{projectCeoRu.workspace.changes.noReviewCapability}</p>}
                {mayReview && change.impacts.filter((impact) => impact.disposition === null).map((impact) => (
                  <div key={`${impact.impactRunId}:${impact.impactId}`} className="mt-3 rounded-lg border border-line p-3">
                    <p className="text-sm font-medium">{impact.label}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {(["accepted", "resolved", "dismissed"] as const).map((disposition) => (
                        <ProjectCeoCommandButton
                          key={disposition}
                          command={{
                            contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                            kind: "review_change_impact",
                            projectId: view.project.id,
                            payload: {
                              impactRunId: impact.impactRunId,
                              impactId: impact.impactId,
                              disposition,
                              reason: projectCeoRu.workspace.changes.impactReason[disposition],
                            },
                          }}
                          disabled={view.operations.review_change_impact.status !== "available"}
                          className="rounded-lg border border-line px-3 py-2 text-xs font-medium hover:border-accent"
                        >
                          {projectCeoRu.workspace.changes.impactAction[disposition]}
                        </ProjectCeoCommandButton>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        ))}
      </section>

      {/*
        Project Inbox sits on the changes tab because that is where the first
        vertical lands: a builder's message becomes a change candidate, and a
        human turns it into a change with the module's own command. The panel
        hides itself when the bridge is off, rather than showing an empty list —
        an empty list would promise a channel that is not there.
      */}
      <TelegramInboxPanel projectId={view.project.id} />
    </div>
  );
}

function ParticipantsView({ view }: { readonly view: ProjectWorkspaceView }) {
  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.participants.projectMembership}</p>
        <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.participants.title}</h2>
        <div className="mt-4 overflow-x-auto rounded-xl border border-line">
          <table className="min-w-[640px] w-full text-left text-sm">
            <thead className="bg-paper text-xs text-muted">
              <tr>
                <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.participants.participant}</th>
                <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.participants.role}</th>
                <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.participants.scope}</th>
                <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.participants.status}</th>
              </tr>
            </thead>
            <tbody>
              {view.participants.map((participant) => (
                <tr key={participant.id} className="border-t border-line">
                  <td className="px-3 py-3 font-medium">{participant.displayName}</td>
                  <td className="px-3 py-3">{projectCeoRu.roles[participant.role]}</td>
                  <td className="px-3 py-3 text-muted">{participant.scopeLabel}</td>
                  <td className="px-3 py-3"><Badge tone="success">{participant.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <h2 className="font-display text-2xl font-semibold">{projectCeoRu.workspace.participants.accessStates}</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {view.invitations.map((invitation) => (
            <article key={invitation.id} className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{invitation.recipientLabel}</p>
                <Badge tone={invitation.status === "accepted" ? "success" : invitation.status === "pending" ? "warning" : "danger"}>
                  {invitation.status}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted">
                {projectCeoRu.roles[invitation.role]} · {invitation.scopeLabel}
              </p>
              {invitation.shareUrl && (
                <div className="mt-3"><CopyLinkButton url={invitation.shareUrl} compact /></div>
              )}
            </article>
          ))}
          {view.grants.map((grant) => {
            return (
              <article key={grant.id} className="rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{grant.label}</p>
                  <Badge tone={grant.status === "active" ? "success" : "danger"}>
                    {grant.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {projectCeoRu.workspace.participants.exactUntil} {formatDate(grant.expiresAt)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {grant.shareUrl && <CopyLinkButton url={grant.shareUrl} compact />}
                  {grant.status === "active" && (
                    <ProjectCeoCommandButton
                      command={{
                        contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
                        kind: "revoke_guest_grant",
                        projectId: view.project.id,
                        payload: { grantId: grant.id },
                      }}
                      confirmation={projectCeoRu.workspace.participants.revokeConfirm(grant.label)}
                      className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700"
                      disabled={view.operations.revoke_guest_grant.status !== "available"}
                    >
                      {projectCeoRu.actions.revoke}
                    </ProjectCeoCommandButton>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/*
        The chat bridge sits beside participants rather than inside a module:
        connecting a chat is a question of project access, not of module 1, 2,
        3 or 4. The panel fetches its own state through its own route and never
        enters this workspace read port — A7 2.1 keeps Telegram code out of the
        modules, and threading channel state through delivery would put it back.
      */}
      <TelegramChannelPanel projectId={view.project.id} />
    </div>
  );
}

function HistoryView({ view }: { readonly view: ProjectWorkspaceView }) {
  return (
    <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.history.appendOnly}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.history.title}</h2>
        </div>
        <Badge tone="neutral">{projectCeoRu.workspace.history.safeProjection}</Badge>
      </div>
      <ol className="mt-5 space-y-3">
        {view.history.map((event) => (
          <li key={event.id} className="relative rounded-xl border border-line p-4 pl-10">
            <span aria-hidden="true" className="absolute left-4 top-5 h-2.5 w-2.5 rounded-full bg-accent" />
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-medium">{event.event}</p>
                <p className="mt-1 text-xs text-muted">{event.controlledDetail}</p>
              </div>
              <div className="text-xs text-muted sm:text-right">
                <p>{event.actorRole}</p>
                <p>{formatDate(event.occurredAt)}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Registering a sheet from an approved M2 decision.
 *
 * The form asks for a number and a title only. Room, layout signature and the
 * approved commit are not asked because they cannot be chosen: the server
 * derives provenance from the published handoff, and the RPC has no parameters
 * to override it with.
 */
function RegisterSheetForm({
  view,
}: {
  readonly view: ProjectWorkspaceView;
}) {
  const documentation = view.documentation;
  const operation = view.operations.register_documentation_sheet;
  const handoffs = documentation?.completeness ?? [];
  const [sheetNumber, setSheetNumber] = useState("");
  const [title, setTitle] = useState("");
  const [handoffId, setHandoffId] = useState(handoffs[0]?.handoffId ?? "");
  const handoff = handoffs.find((item) => item.handoffId === handoffId) ?? handoffs[0] ?? null;
  const complete = Boolean(sheetNumber.trim() && title.trim() && handoff);
  // The same declared sheet keeps one identity across retries and remounts —
  // the register RPC refuses a second sheet id, so a random id would turn an
  // accidental double press into a stuck form.
  const sheetId = recordIdFromContent([
    "m3-sheet", handoff?.handoffId ?? "", sheetNumber,
  ]);
  const revisionId = recordIdFromContent([
    "m3-sheet-r1", handoff?.handoffId ?? "", sheetNumber, title,
  ]);

  if (operation.status !== "available") {
    return (
      <p className="mt-3 text-xs text-muted">
        {operation.reason === "module_disabled"
          ? projectCeoRu.workspace.sources.moduleDisabled
          : operation.reason === "prerequisite_missing"
            ? projectCeoRu.workspace.documentation.registerSheetNoHandoff
            : projectCeoRu.workspace.documentation.noRegisterSheet}
      </p>
    );
  }

  return (
    <div className="mt-4 rounded-xl border border-line/70 p-3">
      <p className="text-sm font-medium">{projectCeoRu.workspace.documentation.registerSheetTitle}</p>
      <p className="mt-1 text-xs text-muted">{projectCeoRu.workspace.documentation.registerSheetHint}</p>
      <div className="mt-3 grid gap-2">
        <div className="grid grid-cols-[8rem_1fr] gap-2">
          <label className="text-xs text-muted">
            {projectCeoRu.workspace.documentation.sheetNumberLabel}
            <input
              value={sheetNumber}
              onChange={(event) => setSheetNumber(event.target.value)}
              placeholder={projectCeoRu.workspace.documentation.sheetNumberPlaceholder}
              className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink"
            />
          </label>
          <label className="text-xs text-muted">
            {projectCeoRu.workspace.documentation.sheetTitleLabel}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={projectCeoRu.workspace.documentation.sheetTitlePlaceholder}
              className="mt-1 w-full rounded-lg border border-line px-2 py-2 text-sm text-ink"
            />
          </label>
        </div>
        {handoffs.length > 1 && (
          <label className="text-xs text-muted">
            {projectCeoRu.workspace.documentation.approvedInput}
            <select
              value={handoff?.handoffId ?? ""}
              onChange={(event) => setHandoffId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm text-ink"
            >
              {handoffs.map((item) => (
                <option key={item.handoffId} value={item.handoffId}>{item.roomId}</option>
              ))}
            </select>
          </label>
        )}
        <ProjectCeoCommandButton
          disabled={!complete}
          command={{
            contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
            kind: "register_documentation_sheet" as const,
            projectId: view.project.id,
            payload: {
              packageId: handoff?.packageId ?? "",
              handoffId: handoff?.handoffId ?? "",
              handoffRevisionId: handoff?.handoffRevisionId ?? "",
              sheetId,
              sheetNumber: sheetNumber.trim(),
              title: title.trim(),
              revisionId,
              specificationRevisionIds: [],
              reason: projectCeoRu.workspace.documentation.registerSheetReason(sheetNumber.trim()),
            },
          }}
        >
          {projectCeoRu.workspace.documentation.registerSheet}
        </ProjectCeoCommandButton>
        {!complete && (
          <p className="text-xs text-muted">{projectCeoRu.workspace.documentation.registerSheetIncomplete}</p>
        )}
      </div>
    </div>
  );
}

/**
 * Reflecting an uncovered approved selection onto a sheet.
 *
 * The candidates are exactly the SPECIFICATION_NOT_COVERED findings: the
 * completeness review names the gap, and this control lets a human close it —
 * with a new sheet revision that leaves the previous one as issued.
 */
function AttachSpecificationControl({
  view,
  report,
  finding,
}: {
  readonly view: ProjectWorkspaceView;
  readonly report: { readonly packageId: string };
  readonly finding: { readonly code: string; readonly subject: string };
}) {
  const documentation = view.documentation;
  const operation = view.operations.attach_documentation_sheet_specifications;
  // Only sheets of this finding's package are valid targets: a foreign sheet
  // would be refused by the server (the selection is not in its approved set),
  // and offering it would be promising a refusal.
  const sheets = (documentation?.sheets ?? []).filter(
    (item) => item.packageId === report.packageId,
  );
  const [sheetId, setSheetId] = useState(sheets[0]?.sheetId ?? "");
  if (finding.code !== "SPECIFICATION_NOT_COVERED") return null;
  if (operation.status !== "available" || sheets.length === 0) return null;
  const sheet = sheets.find((item) => item.sheetId === sheetId) ?? sheets[0]!;
  const revisionId = recordIdFromContent([
    "m3-sheet-attach", sheet.sheetId, sheet.revisionId, finding.subject,
  ]);

  return (
    <span className="mt-1 inline-flex items-center gap-2">
      {sheets.length > 1 && (
        <select
          value={sheet.sheetId}
          onChange={(event) => setSheetId(event.target.value)}
          className="rounded-lg border border-line px-2 py-1 text-xs text-ink"
          aria-label={projectCeoRu.workspace.documentation.attachTo(sheet.sheetNumber)}
        >
          {sheets.map((item) => (
            <option key={item.sheetId} value={item.sheetId}>{item.sheetNumber}</option>
          ))}
        </select>
      )}
      <ProjectCeoCommandButton
        className="btn-ghost text-xs"
        command={{
          contractVersion: PROJECTCEO_COMMAND_CONTRACT_VERSION,
          kind: "attach_documentation_sheet_specifications" as const,
          projectId: view.project.id,
          payload: {
            packageId: sheet.packageId,
            sheetId: sheet.sheetId,
            revisionId,
            expectedRevisionId: sheet.revisionId,
            specificationRevisionIds: [finding.subject],
            reason: projectCeoRu.workspace.documentation.attachReason(sheet.sheetNumber),
          },
        }}
      >
        {projectCeoRu.workspace.documentation.attachSpecification}
      </ProjectCeoCommandButton>
    </span>
  );
}

/**
 * The documentation package: its sheets and what it is missing.
 *
 * Completeness arrives already computed by the module's own code — the UI
 * neither recomputes nor softens it. It approves and releases nothing: it
 * names the gap and leaves the decision to a human.
 */
function DocumentationView({
  view,
}: {
  readonly view: ProjectWorkspaceView;
}) {
  const documentation = view.documentation;
  if (!documentation) {
    return (
      <section className="rounded-2xl border border-line bg-paper p-4 text-sm text-muted">
        {projectCeoRu.workspace.documentation.unavailable}
      </section>
    );
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_21rem]">
      <section className="min-w-0 rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl font-semibold">{projectCeoRu.workspace.documentation.sheets}</h2>
          <Badge tone="neutral">{projectCeoRu.workspace.documentation.sheetCount(documentation.sheets.length)}</Badge>
        </div>
        {documentation.sheets.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{projectCeoRu.workspace.documentation.noSheets}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs uppercase tracking-[0.14em] text-muted">
                <tr>
                  <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.documentation.number}</th>
                  <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.documentation.title}</th>
                  <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.documentation.room}</th>
                  <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.documentation.revision}</th>
                  <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.documentation.specifications}</th>
                  <th className="px-3 py-3 font-medium">{projectCeoRu.workspace.documentation.layoutSignature}</th>
                </tr>
              </thead>
              <tbody>
                {documentation.sheets.map((sheet) => (
                  <tr key={sheet.sheetId} className="border-t border-line/70">
                    <td className="px-3 py-3 font-medium">{sheet.sheetNumber}</td>
                    <td className="px-3 py-3">{sheet.title}</td>
                    <td className="px-3 py-3 text-muted">{sheet.roomId}</td>
                    <td className="px-3 py-3">{projectCeoRu.workspace.documentation.revisionNo(sheet.revisionNo)}</td>
                    <td className="px-3 py-3">{sheet.specificationRevisionIds.length}</td>
                    {/* The layout signature is why a sheet is evidence at all,
                        so it belongs in the table, not behind a detail pane. */}
                    <td className="px-3 py-3 font-mono text-xs text-muted">{shortHash(sheet.layoutSemanticHash)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <RegisterSheetForm view={view} />
      </section>

      <aside className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          {projectCeoRu.workspace.documentation.completeness}
        </p>
        {documentation.completeness.length === 0 ? (
          <p className="mt-3 text-sm text-muted">{projectCeoRu.workspace.documentation.noApprovedInput}</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {documentation.completeness.map((report) => (
              <li key={report.handoffId} className="rounded-xl border border-line/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{report.roomId}</span>
                  <Badge tone={report.complete ? "success" : "warning"}>
                    {report.complete
                      ? projectCeoRu.workspace.documentation.complete
                      : projectCeoRu.workspace.documentation.incomplete}
                  </Badge>
                </div>
                {report.findings.length > 0 && (
                  <ul className="mt-3 space-y-2 text-sm">
                    {report.findings.map((finding) => (
                      <li key={`${finding.code}:${finding.subject}`}>
                        <p>{projectCeoRu.workspace.documentation.findings[finding.code]}</p>
                        <p className="mt-0.5 font-mono text-xs text-muted">{finding.subject}</p>
                        <AttachSpecificationControl view={view} report={report} finding={finding} />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-muted">{projectCeoRu.workspace.documentation.decisionIsHuman}</p>
      </aside>
    </div>
  );
}

function TabContent({
  tab,
  view,
  role,
}: {
  readonly tab: ProjectCeoTab;
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
}) {
  switch (tab) {
    case "overview": return <OverviewView view={view} role={role} />;
    case "sources": return <SourcesView view={view} role={role} />;
    case "decisions": return <DecisionsView view={view} role={role} />;
    case "documentation": return <DocumentationView view={view} />;
    case "baseline": return <BaselineView view={view} role={role} />;
    case "releases": return <ReleasesView view={view} role={role} />;
    case "changes": return <ChangesView view={view} role={role} />;
    case "participants": return <ParticipantsView view={view} />;
    case "history": return <HistoryView view={view} />;
  }
}

export function ProjectCeoWorkspace({
  view,
}: {
  readonly view: ProjectWorkspaceView;
}) {
  const role = view.actor.role;
  const [scenario, setScenario] = useState<UiScenario>("ready");
  // A module tab is never left hanging empty: when the surface does not exist
  // for this human (module off, or the role receives no sheets), it is absent
  // from the navigation too.
  const visibleTabs = visibleTabsForRole(role).filter((item) => (
    item !== "documentation" || view.documentation !== null
  ));
  const [tab, setTab] = useState<ProjectCeoTab>("overview");
  const effectiveTab = visibleTabs.includes(tab) ? tab : visibleTabs[0]!;

  return (
    <div className="min-w-0">
      <Header
        view={view}
        scenario={scenario}
        onScenario={setScenario}
      />

      <nav
        aria-label={projectCeoRu.workspace.navigationAria}
        className="mt-5 overflow-x-auto rounded-2xl border border-line bg-white p-2 shadow-sm"
      >
        <div className="flex min-w-max gap-1" role="tablist">
          {visibleTabs.map((item) => (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={effectiveTab === item}
              onClick={() => setTab(item)}
              className={`min-h-10 rounded-xl px-3 py-2 text-sm font-medium outline-none focus:ring-2 focus:ring-accent/30 ${
                effectiveTab === item
                  ? "bg-coal text-ivory"
                  : "text-muted hover:bg-paper hover:text-ink"
              }`}
            >
              {projectCeoRu.tabs[item]}
            </button>
          ))}
        </div>
      </nav>

      <main className="mt-5">
        <ScenarioPanel scenario={scenario} onReady={() => setScenario("ready")}>
          <TabContent tab={effectiveTab} view={view} role={role} />
        </ScenarioPanel>
      </main>
    </div>
  );
}
