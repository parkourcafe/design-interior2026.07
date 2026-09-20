import { redirect } from "next/navigation";
import { getStudio } from "@/lib/studio";
import { createClient } from "@/lib/supabase/server";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

import { activationMetrics, activationStages, launchErrorTypes, type LaunchEvent } from "@/lib/analytics/launch-metrics";

const l = ru.analytics;

function pct(a: number, b: number): string {
  if (b === 0) return "—";
  return `${Math.round((a / b) * 100)}%`;
}

export default async function AnalyticsPage() {
  const studio = await getStudio();
  if (studio?.role !== "owner") redirect("/dashboard");
  const supabase = await createClient();
  const events: LaunchEvent[] = [];
  // PostgREST caps responses: read every page rather than silently truncate history.
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from("events")
      .select("type, project_id, created_at").eq("designer_id", studio.studioId)
      .order("created_at").order("id").range(offset, offset + 999);
    if (error || !data) return <p role="alert">{l.loadError}</p>;
    events.push(...data as LaunchEvent[]);
    if (data.length < 1000) break;
  }
  const metrics = activationMetrics(events);
  const links = metrics.counts.intake_link_created;
  const started = metrics.counts.brief_started;
  const completed = metrics.counts.brief_completed;
  const sent = metrics.counts.proposal_sent;
  const avgDays = metrics.timeToProposal.meanMs === null ? "—" : (metrics.timeToProposal.meanMs / 86_400_000).toFixed(1);
  const funnel = activationStages.map((type) => ({ label: l.stages[type], value: metrics.counts[type], of: links }));

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">{ru.nav.analytics}</h1>
      <p className="mt-1 text-sm text-muted">{l.description}</p>

      {/* Ключевые метрики */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label={l.completion} value={pct(completed, started)} hint={l.completionHint} />
        <Tile label={l.started} value={pct(started, links)} hint={l.startedHint} />
        <Tile label={l.sent} value={pct(sent, completed)} hint={l.sentHint} />
        <Tile label={l.proposalTime} value={avgDays === "—" ? "—" : `${avgDays} ${l.days}`} hint={l.proposalTimeHint} />
      </div>

      {/* Воронка */}
      <div className="mt-8">
        <h2 className="mb-3 font-display text-2xl font-semibold">{l.funnel}</h2>
        <div className="card space-y-3">
          {funnel.map((f) => (
            <div key={f.label}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span>{f.label}</span>
                <span className="text-muted">
                  {f.value} · {pct(f.value, f.of)}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-line">
                <div
                  className="h-2 rounded-full bg-accent transition-all"
                  style={{ width: links > 0 ? `${Math.round((f.value / links) * 100)}%` : "0%" }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-2xl font-semibold">{l.errorsTitle}</h2>
        <p className="mb-3 text-sm text-muted">{l.errorsHint}</p>
        <dl className="space-y-2">
          {launchErrorTypes.map((type) => <div className="flex justify-between gap-4" key={type}>
            <dt>{l.errors[type]}</dt><dd>{metrics.errorEvents[type]}</dd>
          </div>)}
        </dl>
      </section>
      {metrics.projectsWithoutLink > 0 && <p className="mt-4 text-sm text-muted">{l.excluded}: {metrics.projectsWithoutLink}</p>}
      {events.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          {l.empty}
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-display text-3xl font-semibold text-accent">{value}</div>
      <div className="mt-1 text-[11px] text-muted">{hint}</div>
    </div>
  );
}
