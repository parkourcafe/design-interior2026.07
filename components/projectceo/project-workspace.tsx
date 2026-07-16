"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import type {
  AccessGrantView,
  ChangeRequestView,
  ProjectCeoRole,
  ProjectCeoTab,
  ProjectWorkspaceView,
  ReleaseSummary,
  SourceRegistryItem,
  UiScenario,
} from "./contracts";
import { Badge, Metric } from "./badges";
import { CopyLinkButton } from "./copy-link-button";
import { can, visibleTabsForRole } from "./role-policy";
import { ScenarioPanel, ScenarioSwitcher } from "./state-panel";

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

function sourceTone(source: SourceRegistryItem) {
  if (source.quarantine) return "danger" as const;
  if (source.reviewStatus === "pending") return "warning" as const;
  if (source.reviewStatus === "confirmed") return "success" as const;
  return "neutral" as const;
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
                {projectCeoRu.workspace.header.fullProjectArea(
                  view.project.areaM2.toLocaleString(projectCeoRu.common.locale),
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

function OverviewView({
  view,
  role,
}: {
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
}) {
  const [photoPreviewAdded, setPhotoPreviewAdded] = useState(false);
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
        </section>

        <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.overview.m4Thin}</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.overview.executionHandover}</h2>
          <div className="mt-4 space-y-3">
            {view.milestones.map((milestone) => (
              <div key={milestone.id} className="flex items-center justify-between gap-3 rounded-xl bg-paper p-3">
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
            ))}
            {view.milestones.length === 0 && (
              <p className="rounded-xl bg-paper p-4 text-sm text-muted">{projectCeoRu.workspace.overview.noFieldEvidence}</p>
            )}
          </div>
          {mayUploadPhoto && (
            <button
              type="button"
              onClick={() => setPhotoPreviewAdded(true)}
              className="btn-ghost mt-4 w-full"
            >
              {photoPreviewAdded ? projectCeoRu.actions.photoAdded : projectCeoRu.actions.addPhoto}
            </button>
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
  const [localReviews, setLocalReviews] = useState<Readonly<Record<string, SourceRegistryItem["reviewStatus"]>>>({});
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
  const mayReview = can(role, "review_source");

  function review(status: SourceRegistryItem["reviewStatus"]): void {
    if (!selected || !mayReview) return;
    setLocalReviews((current) => ({ ...current, [selected.id]: status }));
  }

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
                const reviewStatus = localReviews[source.id] ?? source.reviewStatus;
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
              <Badge tone={sourceTone(selected)}>{localReviews[selected.id] ?? selected.reviewStatus}</Badge>
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
            <div className="mt-5 grid gap-2">
              <button type="button" disabled={!mayReview} onClick={() => review("confirmed")} className="btn-primary">
                {projectCeoRu.actions.confirmSource}
              </button>
              <button type="button" disabled={!mayReview} onClick={() => review("clarification_requested")} className="btn-ghost">
                {projectCeoRu.actions.clarification}
              </button>
              <button type="button" disabled={!mayReview} onClick={() => review("rejected")} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-40">
                {projectCeoRu.actions.reject}
              </button>
            </div>
            {!mayReview && <p className="mt-3 text-xs text-muted">{projectCeoRu.workspace.sources.noReviewCapability}</p>}
          </>
        ) : (
          <p className="mt-3 text-sm text-muted">{projectCeoRu.workspace.sources.notSelected}</p>
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
  const [selectionStatus, setSelectionStatus] = useState(view.selections[0]?.reviewStatus ?? "draft");
  const mayReview = can(role, "review_selection");
  const mayCreate = can(role, "create_selection");

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-line bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.workspace.decisions.exactRevisions}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.workspace.decisions.decisions}</h2>
          </div>
          {mayCreate && <button type="button" className="btn-ghost text-xs">{projectCeoRu.actions.createDecision}</button>}
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
                disabled={!mayReview}
                onClick={() => setSelectionStatus("approved")}
                className="btn-primary"
              >
                {projectCeoRu.actions.approve}
              </button>
              <button
                type="button"
                disabled={!mayReview}
                onClick={() => setSelectionStatus("change_requested")}
                className="btn-ghost"
              >
                {projectCeoRu.actions.change}
              </button>
              <button
                type="button"
                disabled={!mayReview}
                onClick={() => setSelectionStatus("rejected")}
                className="rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-700 disabled:opacity-40"
              >
                {projectCeoRu.actions.reject}
              </button>
            </div>
            {!mayReview && <p className="mt-3 text-xs text-muted">{projectCeoRu.workspace.decisions.noReviewCapability}</p>}

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
  );
}

function BaselineView({
  view,
  role,
}: {
  readonly view: ProjectWorkspaceView;
  readonly role: ProjectCeoRole;
}) {
  const [published, setPublished] = useState(view.baseline.status === "published");
  const mayPublish = can(role, "publish_baseline");

  function publish(): void {
    if (!window.confirm(projectCeoRu.workspace.baseline.publishConfirm)) return;
    setPublished(true);
  }

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
          <button type="button" disabled={!mayPublish || view.baseline.blockerCount > 0} onClick={publish} className="btn-primary mt-5">
            {projectCeoRu.actions.publish}
          </button>
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
}: {
  readonly release: ReleaseSummary;
  readonly role: ProjectCeoRole;
}) {
  const [acknowledged, setAcknowledged] = useState(
    release.distributionStatus === "acknowledged",
  );
  const mayAcknowledge = can(role, "acknowledge_release");
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
        {release.status === "current" && mayAcknowledge && (
          <button type="button" onClick={() => setAcknowledged(true)} className="btn-primary ml-auto">
            {projectCeoRu.actions.acknowledge}
          </button>
        )}
      </div>
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
        <ReleaseCard key={release.id} release={release} role={role} />
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
  const [changes, setChanges] = useState<readonly ChangeRequestView[]>(view.changes);
  const [reason, setReason] = useState("");
  const mayCreate = can(role, "create_change");
  const mayReview = can(role, "review_change_impact");

  function createChange(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!reason.trim() || !mayCreate) return;
    setChanges((current) => [{
      id: "change-request-local-preview",
      title: projectCeoRu.workspace.changes.newTitle,
      status: "submitted",
      fromBaseline: `Baseline V${view.baseline.versionNo}`,
      toBaseline: null,
      deltaRub: 0,
      deltaDays: 0,
      requestedAt: new Date("2026-07-17T10:00:00Z").toISOString(),
      impactCount: 0,
      reviewedImpactCount: 0,
      reason,
    }, ...current]);
    setReason("");
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
        <button type="submit" disabled={!mayCreate || !reason.trim()} className="btn-primary mt-3 w-full">
          {projectCeoRu.actions.requestChange}
        </button>
        {!mayCreate && <p className="mt-3 text-xs text-muted">{projectCeoRu.workspace.changes.noCreateCapability}</p>}
      </form>

      <section className="space-y-3">
        {changes.map((change) => (
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
            {change.impactCount > 0 && (
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-muted">
                  <span>{projectCeoRu.workspace.changes.humanDispositions}</span>
                  <span>{change.reviewedImpactCount}/{change.impactCount}</span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-line">
                  <div
                    className="h-2 rounded-full bg-accent"
                    style={{ width: `${Math.round(change.reviewedImpactCount / change.impactCount * 100)}%` }}
                  />
                </div>
                {!mayReview && <p className="mt-2 text-xs text-muted">{projectCeoRu.workspace.changes.noReviewCapability}</p>}
              </div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}

function ParticipantsView({ view }: { readonly view: ProjectWorkspaceView }) {
  const [revoked, setRevoked] = useState<readonly string[]>([]);

  function revoke(grant: AccessGrantView): void {
    if (!window.confirm(projectCeoRu.workspace.participants.revokeConfirm(grant.label))) return;
    setRevoked((current) => [...current, grant.id]);
  }

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
            const localRevoked = revoked.includes(grant.id);
            return (
              <article key={grant.id} className="rounded-xl border border-line p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium">{grant.label}</p>
                  <Badge tone={grant.status === "active" && !localRevoked ? "success" : "danger"}>
                    {localRevoked ? "revoked" : grant.status}
                  </Badge>
                </div>
                <p className="mt-2 text-xs text-muted">
                  {projectCeoRu.workspace.participants.exactUntil} {formatDate(grant.expiresAt)}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {grant.shareUrl && !localRevoked && <CopyLinkButton url={grant.shareUrl} compact />}
                  {grant.status === "active" && !localRevoked && (
                    <button
                      type="button"
                      onClick={() => revoke(grant)}
                      className="rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-700"
                    >
                      {projectCeoRu.actions.revoke}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
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
  const visibleTabs = visibleTabsForRole(role);
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
