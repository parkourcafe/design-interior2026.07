import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Ответ клиента на публичное КП: принять / обсудить / запросить правки.
// Без миграций: ответ фиксируется событием (events), первый ответ — финальный.
// Это подтверждение намерения, не юридическая подпись (см. i18n respond.note).
import { ACTION_EVENT, RESPONSE_TYPES } from "@/lib/proposal/respond";

export async function POST(request: Request) {
  if (!(await checkRateLimit("proposal_respond", clientIp(request), 20, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { token?: string; action?: string };
  const eventType = body.action ? ACTION_EVENT[body.action] : undefined;
  if (!body.token || !eventType) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: proposal } = await admin
    .from("proposals")
    .select("project_id, status")
    .eq("public_token", body.token)
    .maybeSingle();

  // Отвечать можно только на отправленное КП; черновики не раскрываем.
  if (!proposal || (proposal as { status?: string }).status !== "sent") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const projectId = (proposal as { project_id: string }).project_id;

  // Первый ответ — финальный: повторные клики не перезаписывают решение.
  const { data: existing } = await admin
    .from("events")
    .select("type")
    .eq("project_id", projectId)
    .in("type", RESPONSE_TYPES)
    .order("created_at", { ascending: true })
    .limit(1);
  const first = existing?.[0];
  if (first) {
    return NextResponse.json({ ok: true, response: first.type });
  }

  const { data: project } = await admin
    .from("projects")
    .select("designer_id")
    .eq("id", projectId)
    .maybeSingle();

  await admin.from("events").insert({
    designer_id: (project as { designer_id?: string | null } | null)?.designer_id ?? null,
    project_id: projectId,
    type: eventType,
  });

  return NextResponse.json({ ok: true, response: eventType });
}
