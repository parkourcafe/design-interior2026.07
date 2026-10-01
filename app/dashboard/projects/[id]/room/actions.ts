"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getStudio } from "@/lib/studio";
import { makeToken } from "@/lib/tokens";
import { buildInitialTasks } from "@/lib/project-room/build";
import type { AnswersMap, Passport, PricingConfig, ProposalSection } from "@/lib/types";
import { ru } from "@/lib/i18n/ru";
import {
  KIT_BUCKET,
  contractorPassport,
  contractorProposalSections,
  fileEntry,
  kitFileSources,
  snapshotEntry,
  type ManifestEntry,
} from "@/lib/project-room/handover";
import type { TaskStatus } from "@/lib/project-room/types";

export async function createProjectRoom(projectId: string): Promise<{ ok: boolean; roomId?: string; reason?: string }> {
  const supabase = await createClient();
  const studio = await getStudio();
  if (!studio) return { ok: false, reason: "unauthorized" };

  const { data: project } = await supabase.from("projects").select("id, client_name, status, passport").eq("id", projectId).maybeSingle();
  if (!project) return { ok: false, reason: "not_found" };
  const { data: proposal } = await supabase.from("proposals").select("id, status, sections").eq("project_id", projectId).eq("status", "accepted").order("version", { ascending: false }).limit(1).maybeSingle();
  if (!proposal || (project as { status: string }).status !== "proposal_accepted") return { ok: false, reason: "proposal_not_accepted" };

  const { data: existing } = await supabase.from("project_rooms").select("id").eq("project_id", projectId).maybeSingle();
  if (existing) return { ok: true, roomId: (existing as { id: string }).id };

  const passport = (project as { passport: Passport | null }).passport;
  const packageChoice = passport?.scope.package ?? "concept";
  const { data: room, error: roomError } = await supabase.from("project_rooms").insert({
    project_id: projectId,
    proposal_id: (proposal as { id: string }).id,
    scope_package: packageChoice,
    pricing_snapshot: (studio.designer.pricing ?? null) as PricingConfig | null,
  }).select("id").single();
  if (roomError || !room) return { ok: false, reason: "room_create_failed" };
  const roomId = (room as { id: string }).id;

  const { data: participants, error: participantError } = await supabase.from("project_participants").insert([
    { room_id: roomId, role: "designer", display_name: studio.designer.name || studio.designer.studio_name, auth_user_id: studio.userId },
    { room_id: roomId, role: "client", display_name: (project as { client_name: string }).client_name, access_token: makeToken() },
    { room_id: roomId, role: "executor", display_name: "Исполнитель", access_token: makeToken() },
  ]).select("id, role");
  if (participantError || !participants) {
    await supabase.from("project_rooms").delete().eq("id", roomId);
    return { ok: false, reason: "participant_create_failed" };
  }
  const byRole = new Map(participants.map((p) => [(p as { role: string }).role, (p as { id: string }).id]));

  const { data: risks } = await supabase.from("risk_cards").select("id, impact, proposal_implication").eq("project_id", projectId).eq("status", "accepted");
  const seeds = buildInitialTasks({
    start: new Date(), packageChoice,
    sections: ((proposal as { sections?: unknown }).sections ?? []) as ProposalSection[],
    acceptedRisks: (risks ?? []) as { id: string; impact: string; proposal_implication: string }[],
  });
  const { data: tasks, error: taskError } = await supabase.from("project_tasks").insert(seeds.map((task) => ({
    ...task, room_id: roomId, status: task.status ?? "todo", assignee_participant_id: byRole.get(task.owner_role) ?? null,
  }))).select("id, title");
  if (taskError) {
    await supabase.from("project_rooms").delete().eq("id", roomId);
    return { ok: false, reason: "task_create_failed" };
  }

  await supabase.from("project_task_events").insert([
    { room_id: roomId, actor_role: "system", event_type: "room_created", details: { proposal_id: (proposal as { id: string }).id } },
    ...(tasks ?? []).map((task) => ({ room_id: roomId, task_id: (task as { id: string }).id, actor_role: "system", event_type: "task_created", details: { title: (task as { title: string }).title } })),
  ]);
  await supabase.from("projects").update({ status: "active_project" }).eq("id", projectId);
  await supabase.from("events").insert({ designer_id: studio.studioId, project_id: projectId, type: "project_room_created" });
  revalidatePath(`/dashboard/projects/${projectId}`);
  return { ok: true, roomId };
}

export async function updateDesignerTask(projectId: string, taskId: string, status: TaskStatus): Promise<{ ok: boolean }> {
  const supabase = await createClient();
  const { data: task } = await supabase.from("project_tasks").select("id, room_id, status").eq("id", taskId).maybeSingle();
  if (!task) return { ok: false };
  const previous = (task as { status: string }).status;
  const { error } = await supabase.from("project_tasks").update({ status, updated_at: new Date().toISOString() }).eq("id", taskId);
  if (error) return { ok: false };
  await supabase.from("project_task_events").insert({ room_id: (task as { room_id: string }).room_id, task_id: taskId, actor_role: "designer", event_type: "task_status_changed", from_status: previous, to_status: status });
  revalidatePath(`/dashboard/projects/${projectId}/room`);
  return { ok: true };
}

/**
 * «Передать в работу» (решение владельца 01.10.2026, вариант B): комната проекта
 * и комплект подрядчика уровня 1 из принятого КП. Решение принимает дизайнер;
 * это не «выпуск к стройке». Повторный вызов не создаёт второй комплект.
 * Файлы читаются сессией дизайнера (RLS client-uploads): что студия не видит,
 * то и не уходит. Любой недоступный файл — отказ целиком, без полу-комплекта.
 */
export async function handOverToWork(projectId: string): Promise<{
  ok: boolean;
  reason?: "unauthorized" | "proposal_not_accepted" | "file_unavailable" | "room_failed" | "kit_create_failed";
}> {
  const supabase = await createClient();
  const studio = await getStudio();
  if (!studio) return { ok: false, reason: "unauthorized" };

  const { data: proposal } = await supabase.from("proposals").select("id, version, status, sections")
    .eq("project_id", projectId).eq("status", "accepted").order("version", { ascending: false }).limit(1).maybeSingle();
  if (!proposal) return { ok: false, reason: "proposal_not_accepted" };

  const room = await createProjectRoom(projectId);
  if (!room.ok || !room.roomId) {
    return { ok: false, reason: room.reason === "proposal_not_accepted" ? "proposal_not_accepted" : "room_failed" };
  }
  const { data: existingKit } = await supabase.from("project_handover_kits").select("id").eq("room_id", room.roomId).maybeSingle();
  if (existingKit) return { ok: true };

  const { data: project } = await supabase.from("projects").select("passport").eq("id", projectId).maybeSingle();
  const passport = (project as { passport: Passport | null } | null)?.passport;
  if (!passport) return { ok: false, reason: "proposal_not_accepted" };
  const { data: answerRows } = await supabase.from("answers").select("question_id, value")
    .eq("project_id", projectId).in("question_id", ["designer_plan_attachments", "attachments"]);
  const answers: AnswersMap = {};
  for (const row of answerRows ?? []) {
    answers[(row as { question_id: string }).question_id] = (row as { value: unknown }).value as never;
  }

  const p = proposal as { id: string; version: number; sections: unknown };
  const sections = contractorProposalSections((Array.isArray(p.sections) ? p.sections : []) as ProposalSection[]);
  const summary = contractorPassport(passport);
  const manifest: ManifestEntry[] = [
    snapshotEntry("proposal", ru.handover.proposalEntry(p.version), sections, p.version),
    snapshotEntry("passport_summary", ru.handover.passportEntry, summary),
  ];
  for (const source of kitFileSources(answers, projectId)) {
    const { data: blob, error } = await supabase.storage.from(KIT_BUCKET).download(source.path);
    if (error || !blob) return { ok: false, reason: "file_unavailable" };
    manifest.push(fileEntry(source, new Uint8Array(await blob.arrayBuffer())));
  }

  const { data: kit, error: kitError } = await supabase.from("project_handover_kits").insert({
    room_id: room.roomId,
    project_id: projectId,
    proposal_id: p.id,
    proposal_version: p.version,
    proposal_sections: sections,
    passport_summary: summary,
    manifest,
    created_by: studio.userId,
  }).select("id").maybeSingle();
  // 23505 — комплект уже создан в другой вкладке: результат тот же.
  if (kitError && (kitError as { code?: string }).code !== "23505") return { ok: false, reason: "kit_create_failed" };
  if (kit) {
    await supabase.from("project_task_events").insert({
      room_id: room.roomId, actor_role: "designer", event_type: "handover_kit_created",
      details: { proposal_version: p.version, files: manifest.length },
    });
    await supabase.from("events").insert({ designer_id: studio.studioId, project_id: projectId, type: "handover_kit_created" });
  }
  revalidatePath(`/dashboard/projects/${projectId}/proposal`);
  revalidatePath(`/dashboard/projects/${projectId}/room`);
  return { ok: true };
}
