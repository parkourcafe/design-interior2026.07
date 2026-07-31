import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { ru } from "@/lib/i18n/ru";
import { canSeeTask } from "@/lib/project-room/access";
import type { ParticipantRole, ProjectTask } from "@/lib/project-room/types";
import PublicTaskControls from "./task-controls";

export const dynamic = "force-dynamic";

// Участник Project Room по токену — задачи проекта, вне индекса
// (сверх X-Robots-Tag/robots.txt).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function ParticipantRoomPage({ params }: { params: Promise<{ access_token: string }> }) {
  const { access_token } = await params;
  const admin = createAdminClient();
  const { data: participant } = await admin.from("project_participants").select("id, room_id, role, display_name").eq("access_token", access_token).maybeSingle();
  if (!participant) notFound();
  const p = participant as { id: string; room_id: string; role: ParticipantRole; display_name: string };
  const { data: taskRows } = await admin.from("project_tasks").select("id, title, description, owner_role, assignee_participant_id, due_date, status, client_facing, related_scope_item, proposal_section, created_from, sort_order").eq("room_id", p.room_id).order("sort_order");
  const tasks = ((taskRows ?? []) as ProjectTask[]).filter((task) => canSeeTask(p.role, p.id, task));
  return <main className="mx-auto max-w-3xl px-6 py-10"><header className="mb-7"><p className="text-xs uppercase tracking-widest text-muted">{ru.projectRoom.title}</p><h1 className="font-display text-3xl font-semibold">{p.display_name}</h1><p className="text-sm text-muted">{ru.projectRoom.roleView}: {ru.projectRoom.roles[p.role]}</p></header><div className="space-y-3">{tasks.map((task) => <article className="card" key={task.id}><div className="flex items-start justify-between gap-3"><div><h2 className="font-medium">{task.title}</h2><p className="mt-1 text-sm text-muted">{task.description}</p><p className="mt-2 text-xs text-muted">{ru.projectRoom.due}: {task.due_date ?? "—"}</p></div><span className="rounded-full bg-line/50 px-2 py-1 text-xs">{ru.projectRoom.status[task.status]}</span></div>{task.owner_role === p.role && task.assignee_participant_id === p.id && <PublicTaskControls token={access_token} taskId={task.id} value={task.status} />}</article>)}</div></main>;
}
