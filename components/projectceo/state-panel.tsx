"use client";

import type { ReactNode } from "react";
import { ru } from "@/lib/i18n/ru";
import type { UiScenario } from "./contracts";

const projectCeoRu = ru.projectCeo;

export function ScenarioPanel({
  scenario,
  onReady,
  children,
}: {
  readonly scenario: UiScenario;
  readonly onReady: () => void;
  readonly children: ReactNode;
}) {
  if (scenario === "ready") return <>{children}</>;

  if (scenario === "loading") {
    return (
      <section
        aria-busy="true"
        aria-live="polite"
        className="rounded-2xl border border-line bg-white p-5 shadow-sm"
      >
        <div className="h-4 w-36 animate-pulse rounded bg-line" />
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-line/60" />
        <div className="mt-3 h-16 animate-pulse rounded-xl bg-line/40" />
        <p className="mt-5 text-sm font-medium">{projectCeoRu.states.loadingTitle}</p>
        <p className="mt-1 text-sm text-muted">{projectCeoRu.states.loadingBody}</p>
      </section>
    );
  }

  const stateCopy = {
    empty: {
      title: projectCeoRu.states.emptyTitle,
      body: projectCeoRu.states.emptyBody,
      action: projectCeoRu.actions.back,
    },
    error: {
      title: projectCeoRu.states.errorTitle,
      body: projectCeoRu.states.errorBody,
      action: projectCeoRu.actions.retry,
    },
    stale: {
      title: projectCeoRu.states.staleTitle,
      body: projectCeoRu.states.staleBody,
      action: projectCeoRu.actions.refresh,
    },
    revoked: {
      title: projectCeoRu.states.revokedTitle,
      body: projectCeoRu.states.revokedBody,
      action: projectCeoRu.actions.back,
    },
    expired: {
      title: projectCeoRu.states.expiredTitle,
      body: projectCeoRu.states.expiredBody,
      action: projectCeoRu.actions.back,
    },
  } as const;
  const copy = stateCopy[scenario];

  return (
    <section
      role={scenario === "error" || scenario === "stale" ? "alert" : "status"}
      className="rounded-2xl border border-line bg-white px-5 py-10 text-center shadow-sm"
    >
      <div
        aria-hidden="true"
        className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full text-xl ${
          scenario === "revoked" || scenario === "expired"
            ? "bg-red-50 text-red-700"
            : scenario === "stale"
              ? "bg-amber-50 text-amber-700"
              : "bg-line/50 text-muted"
        }`}
      >
        {scenario === "error" ? "!" : scenario === "stale" ? "↻" : scenario === "empty" ? "＋" : "×"}
      </div>
      <h2 className="mt-4 font-display text-2xl font-semibold">{copy.title}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{copy.body}</p>
      <button type="button" onClick={onReady} className="btn-primary mt-6">
        {copy.action}
      </button>
    </section>
  );
}

export function ScenarioSwitcher({
  value,
  onChange,
}: {
  readonly value: UiScenario;
  readonly onChange: (scenario: UiScenario) => void;
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted sm:max-w-48">
      {projectCeoRu.states.screenState}
      <select
        aria-label={projectCeoRu.states.screenState}
        value={value}
        onChange={(event) => onChange(event.target.value as UiScenario)}
        className="min-h-10 rounded-lg border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        {Object.entries(projectCeoRu.scenarios).map(([scenario, label]) => (
          <option key={scenario} value={scenario}>{label}</option>
        ))}
      </select>
    </label>
  );
}
