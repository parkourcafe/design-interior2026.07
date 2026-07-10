import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { canUpdateTask } from "@/lib/project-room/access";
import type { ParticipantRole, ProjectTask } from "@/lib/project-room/types";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const Body = z.object({ token: z.string().min(16), taskId: z.string().uuid(), status: z.enum(["todo", "in_progress", "blocked", "waiting_client", "waiting_executor", "done"]) });
export async function POST(request: Request) {
  if (!(await checkRateLimit("project_room_task_status", clientIp(request), 60, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const admin = createAdminClient();
  const { data: participant } = await admin.from("project_participants").select("id, room_id, role").eq("access_token", parsed.data.token).maybeSingle();
  if (!participant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const p = participant as { id: string; room_id: string; role: ParticipantRole };
  const { data: task } = await admin.from("project_tasks").select("id, room_id, title, description, owner_role, assignee_participant_id, due_date, status, client_facing, related_scope_item, proposal_section, created_from, sort_order").eq("id", parsed.data.taskId).eq("room_id", p.room_id).maybeSingle();
  if (!task || !canUpdateTask(p.role, p.id, task as ProjectTask)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const previous = (task as ProjectTask).status;
  const { error } = await admin.from("project_tasks").update({ status: parsed.data.status, updated_at: new Date().toISOString() }).eq("id", parsed.data.taskId);
  if (error) return NextResponse.json({ error: "update_failed" }, { status: 500 });
  await admin.from("project_task_events").insert({ room_id: p.room_id, task_id: parsed.data.taskId, actor_role: p.role, event_type: "task_status_changed", from_status: previous, to_status: parsed.data.status });
  return NextResponse.json({ ok: true });
}
