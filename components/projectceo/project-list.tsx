"use client";

import Link from "next/link";
import { useState } from "react";
import { ru } from "@/lib/i18n/ru";
import type {
  PortfolioView,
  ProjectSummary,
  UiScenario,
} from "./contracts";
import { Badge, Metric } from "./badges";
import { OnboardingPanel } from "./onboarding";
import { ScenarioPanel, ScenarioSwitcher } from "./state-panel";

const projectCeoRu = ru.projectCeo;

function stageLabel(stage: ProjectSummary["stage"]): string {
  return projectCeoRu.stage[stage];
}

function ProjectCard({ project, guest }: { readonly project: ProjectSummary; readonly guest: boolean }) {
  const packageQuery = guest ? "?package=kora-architecture-release" : "";
  const isInteractivePilot = project.id === "kora-food-hall";
  return (
    <article className="group rounded-2xl border border-line bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-md">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={project.id === "kora-food-hall" ? "accent" : "neutral"}>
              {stageLabel(project.stage)}
            </Badge>
            {project.secondProjectSignal && <Badge tone="success">{projectCeoRu.portfolio.secondProject}</Badge>}
          </div>
          <h2 className="mt-3 font-display text-2xl font-semibold">{project.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {projectCeoRu.common.projectMeta(
              project.location,
              project.areaM2.toLocaleString(projectCeoRu.common.locale),
              projectCeoRu.common.fullProject.toLocaleLowerCase(projectCeoRu.common.locale),
            )}
          </p>
        </div>
        {isInteractivePilot ? (
          <Link
            href={`/dashboard/projectceo/projects/${project.id}${packageQuery}`}
            className="btn-primary shrink-0"
          >
            {projectCeoRu.actions.open}
          </Link>
        ) : (
          <Badge tone="neutral">{projectCeoRu.portfolio.mappedScope}</Badge>
        )}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-paper p-3">
          <p className="text-[11px] text-muted">{projectCeoRu.portfolio.sources}</p>
          <p className="mt-1 text-lg font-semibold">{project.sourceStats.physicalRecords}</p>
        </div>
        <div className="rounded-xl bg-paper p-3">
          <p className="text-[11px] text-muted">{projectCeoRu.portfolio.baseline}</p>
          <p className="mt-1 text-lg font-semibold">
            {project.baseline.versionNo ? `V${project.baseline.versionNo}` : projectCeoRu.common.dash}
          </p>
        </div>
        <div className="rounded-xl bg-paper p-3">
          <p className="text-[11px] text-muted">{projectCeoRu.portfolio.packages}</p>
          <p className="mt-1 text-lg font-semibold">{project.packageCount}</p>
        </div>
        <div className="rounded-xl bg-paper p-3">
          <p className="text-[11px] text-muted">{projectCeoRu.portfolio.changes}</p>
          <p className="mt-1 text-lg font-semibold">{project.openChangeCount}</p>
        </div>
      </div>

      {project.id === "kora-food-hall" && (
        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4 text-xs text-muted">
          <span><strong className="text-ink">81</strong> {projectCeoRu.portfolio.materialized}</span>
          <span><strong className="text-ink">128</strong> {projectCeoRu.portfolio.placeholderRecords}</span>
          <span><strong className="text-ink">28</strong> {projectCeoRu.portfolio.logicalSources}</span>
          <span><strong className="text-ink">8</strong> {projectCeoRu.portfolio.quarantines}</span>
          <span>{projectCeoRu.common.hiddenFilenames}</span>
        </div>
      )}
    </article>
  );
}

export function ProjectCeoPortfolio({
  view,
}: {
  readonly view: PortfolioView;
}) {
  const [scenario, setScenario] = useState<UiScenario>("ready");
  const role = view.actor.role;

  return (
    <div className="min-w-0">
      <section className="overflow-hidden rounded-3xl bg-coal px-5 py-7 text-ivory shadow-xl sm:px-8 sm:py-9">
        <div className="grid gap-7 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-bronze">
              {projectCeoRu.pilotLabel}
            </p>
            <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold leading-none sm:text-5xl">
              {projectCeoRu.portfolioTitle}
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-ivorymuted sm:text-base">
              {projectCeoRu.portfolioLead}
            </p>
          </div>
          <div className="rounded-2xl border border-linedark bg-white/5 p-4">
            <p className="text-xs text-ivorymuted">{projectCeoRu.portfolio.paidScopes}</p>
            <p className="mt-1 font-display text-4xl font-semibold text-bronze">
              {view.organization.paidPilotScopeCount}
            </p>
            <p className="mt-1 text-xs text-ivorymuted">{projectCeoRu.portfolio.sharedContract}</p>
          </div>
        </div>
      </section>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 text-xs text-muted">
          <p>{projectCeoRu.common.role}</p>
          <p className="mt-1 text-sm font-medium text-ink">{projectCeoRu.roles[role]}</p>
        </div>
        <ScenarioSwitcher value={scenario} onChange={setScenario} />
        <div className="text-xs text-muted sm:text-right">
          <p className="font-medium text-ink">{view.actor.displayName}</p>
          <p>{projectCeoRu.common.serverScopedCapabilities(view.actor.capabilities.length)}</p>
        </div>
      </div>

      <div className="mt-6">
        <ScenarioPanel scenario={scenario} onReady={() => setScenario("ready")}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label={projectCeoRu.portfolio.activeProjects} value={view.organization.activeProjectCount} />
            <Metric label={projectCeoRu.portfolio.physicalRecords} value={209} />
            <Metric label={projectCeoRu.portfolio.materializedBytes} value={81} />
            <Metric label={projectCeoRu.portfolio.placeholders} value={128} />
          </div>

          <div className="mt-6 space-y-4">
            {view.projects.map((project) => (
              <ProjectCard key={project.id} project={project} guest={role === "guest"} />
            ))}
          </div>

          {role === "owner" && (
            <div className="mt-7">
              <OnboardingPanel
                onboarding={view.onboarding}
                invitations={view.invitations}
                grants={view.grants}
              />
            </div>
          )}

          {(role === "owner" || role === "architect") && (
            <section className="mt-7 rounded-2xl border border-line bg-white p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">{projectCeoRu.portfolio.controlledAnalytics}</p>
                  <h2 className="mt-1 font-display text-2xl font-semibold">{projectCeoRu.portfolio.pilotSignals}</h2>
                </div>
                <Badge tone="neutral">{projectCeoRu.portfolio.notAudit}</Badge>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {view.controlledAnalytics.map((event) => (
                  <div key={`${event.name}:${event.occurredAt}`} className="rounded-xl bg-paper p-3">
                    <p className="text-sm font-medium">{event.name}</p>
                    <p className="mt-1 text-xs text-muted">
                      {event.projectId ?? projectCeoRu.portfolio.organization} · {new Date(event.occurredAt).toLocaleDateString(projectCeoRu.common.locale)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </ScenarioPanel>
      </div>
    </div>
  );
}
