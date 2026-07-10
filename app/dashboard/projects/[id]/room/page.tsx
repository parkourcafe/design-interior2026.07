import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requestBaseUrl } from "@/lib/base-url";
import { ru } from "@/lib/i18n/ru";
import { buildAdminSummary } from "@/lib/project-room/summary";
import type { ParticipantRole, ProjectTask } from "@/lib/project-room/types";
import TaskControls from "./task-controls";

export const dynamic = "force-dynamic";

export default async function ProjectRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: room } = await supabase.from("project_rooms").select("id, status, scope_package, created_at, projects(client_name)").eq("project_id", id).maybeSingle();
  if (!room) notFound();
  const roomId = (room as { id: string }).id;
  const [{ data: participantRows }, { data: taskRows }, { data: eventRows }] = await Promise.all([
    supabase.from("project_participants").select("id, role, display_name, access_token").eq("room_id", roomId),
    supabase.from("project_tasks").select("id, title, description, owner_role, assignee_participant_id, due_date, status, client_facing, related_scope_item, proposal_section, created_from, sort_order").eq("room_id", roomId).order("sort_order"),
    supabase.from("project_task_events").select("id, event_type, actor_role, from_status, to_status, details, created_at").eq("room_id", roomId).order("created_at", { ascending: false }).limit(20),
  ]);
  const tasks = (taskRows ?? []) as ProjectTask[];
  const summary = buildAdminSummary(tasks);
  const base = await requestBaseUrl();
  const participants = (participantRows ?? []) as { id: string; role: ParticipantRole; display_name: string; access_token: string | null }[];

  return <div className="space-y-7">
    <header><Link href={`/dashboard/projects/${id}`} className="text-sm text-muted hover:text-ink">← {ru.review.title}</Link><h1 className="mt-1 font-display text-3xl font-semibold">{ru.projectRoom.title}</h1><p className="text-sm text-muted">{ru.projectRoom.humanDecision}</p></header>
    <section><h2 className="mb-3 font-display text-2xl font-semibold">{ru.projectRoom.participants}</h2><div className="grid gap-3 sm:grid-cols-3">{participants.map((participant) => <div key={participant.id} className="card"><p className="text-xs uppercase tracking-wide text-muted">{ru.projectRoom.roles[participant.role]}</p><p className="font-medium">{participant.display_name}</p>{participant.access_token && <a className="mt-2 block break-all text-xs text-accent hover:underline" href={`${base}/room/${participant.access_token}`} target="_blank" rel="noreferrer">{ru.projectRoom.openParticipantView}</a>}</div>)}</div></section>
    <section className="card border-accent/30 bg-accent/5"><h2 className="font-display text-2xl font-semibold">{ru.projectRoom.aiTitle}</h2><p className="mb-3 text-sm text-muted">{ru.projectRoom.aiNote}</p><div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"><span>{ru.projectRoom.overdue}: {summary.overdue.length}</span><span>{ru.projectRoom.blocked}: {summary.blocked.length}</span><span>{ru.projectRoom.waitingClient}: {summary.waitingClient.length}</span><span>{ru.projectRoom.waitingExecutor}: {summary.waitingExecutor.length}</span></div><ul className="mt-3 list-disc pl-5 text-sm">{summary.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul></section>
    <section><h2 className="mb-3 font-display text-2xl font-semibold">{ru.projectRoom.tasks}</h2><div className="space-y-3">{tasks.map((task) => <article key={task.id} className="card grid gap-4 sm:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{task.title}</h3><span className="rounded-full bg-line/50 px-2 py-1 text-xs text-muted">{ru.projectRoom.roles[task.owner_role]}</span>{task.client_facing && <span className="rounded-full bg-accent/10 px-2 py-1 text-xs text-accent">{ru.projectRoom.clientFacing}</span>}</div><p className="mt-1 text-sm text-muted">{task.description}</p><p className="mt-2 text-xs text-muted">{ru.projectRoom.due}: {task.due_date ?? "—"} · {ru.projectRoom.createdFrom[task.created_from]}</p></div><TaskControls projectId={id} taskId={task.id} value={task.status} /></article>)}</div></section>
    <section><h2 className="mb-3 font-display text-2xl font-semibold">{ru.projectRoom.activity}</h2><div className="card space-y-2 text-sm">{(eventRows ?? []).map((event) => { const e = event as { id: string; event_type: string; actor_role: string; from_status: string | null; to_status: string | null; created_at: string }; return <p key={e.id}><span className="text-muted">{new Date(e.created_at).toLocaleString("ru-RU")}</span> · {ru.projectRoom.events[e.event_type] ?? e.event_type}{e.to_status ? `: ${ru.projectRoom.status[e.to_status] ?? e.to_status}` : ""}</p>; })}</div></section>
  </div>;
}
