import { createClient } from "@/lib/supabase/server";
import { ru } from "@/lib/i18n/ru";

export const dynamic = "force-dynamic";

interface EventRow {
  type: string;
  project_id: string | null;
  created_at: string;
}

function pct(a: number, b: number): string {
  if (b === 0) return "—";
  return `${Math.round((a / b) * 100)}%`;
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("type, project_id, created_at")
    .order("created_at", { ascending: true });

  const events = (data ?? []) as EventRow[];
  const count = (t: string) => events.filter((e) => e.type === t).length;

  const links = count("intake_link_created");
  const started = count("brief_started");
  const completed = count("brief_completed");
  const proposals = count("proposal_created");
  const sent = count("proposal_sent");

  // Время до отправленного КП: от brief_completed до proposal_sent по проекту.
  const firstTs = new Map<string, number>();
  const sentTs = new Map<string, number>();
  for (const e of events) {
    if (!e.project_id) continue;
    const ts = Date.parse(e.created_at);
    if (e.type === "brief_completed" && !firstTs.has(e.project_id)) firstTs.set(e.project_id, ts);
    if (e.type === "proposal_sent") sentTs.set(e.project_id, ts);
  }
  const durations: number[] = [];
  for (const [pid, s] of sentTs) {
    const c = firstTs.get(pid);
    if (c && s >= c) durations.push(s - c);
  }
  const avgDays =
    durations.length > 0
      ? (durations.reduce((a, b) => a + b, 0) / durations.length / 86_400_000).toFixed(1)
      : "—";

  const funnel = [
    { label: "Ссылки на бриф", value: links, of: links },
    { label: "Начали бриф", value: started, of: links },
    { label: "Завершили бриф", value: completed, of: links },
    { label: "Создано КП", value: proposals, of: links },
    { label: "Отправлено КП", value: sent, of: links },
  ];

  return (
    <div>
      <h1 className="font-display text-3xl font-semibold">{ru.nav.analytics}</h1>
      <p className="mt-1 text-sm text-muted">Воронка по вашим событиям. Обновляется в реальном времени.</p>

      {/* Ключевые метрики */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Tile label="Доходимость брифа" value={pct(completed, started)} hint="завершили / начали · цель >60%" />
        <Tile label="Начали из ссылки" value={pct(started, links)} hint="начали / ссылок" />
        <Tile label="Бриф → КП отправлено" value={pct(sent, completed)} hint="отправлено / завершили" />
        <Tile label="Среднее время до КП" value={avgDays === "—" ? "—" : `${avgDays} дн.`} hint="от завершения брифа" />
      </div>

      {/* Воронка */}
      <div className="mt-8">
        <h2 className="mb-3 font-display text-2xl font-semibold">Воронка</h2>
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

      {events.length === 0 && (
        <p className="mt-6 text-sm text-muted">
          Пока нет событий. Создайте проект и отправьте бриф — данные появятся здесь.
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
