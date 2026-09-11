import { NextResponse } from "next/server";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
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

  const admin = createScopedServiceClient("proposal-response");
  const { data: proposal } = await admin
    .from("proposals")
    .select("id, project_id, status")
    .eq("public_token", body.token)
    .maybeSingle();

  // Отвечать можно только на отправленное КП; черновики не раскрываем.
  if (!proposal || !["sent", "accepted"].includes((proposal as { status?: string }).status ?? "")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const projectId = (proposal as { project_id: string }).project_id;
  const { data: project, error: projectError } = await admin.from("projects").select("designer_id").eq("id", projectId).maybeSingle();
  if (projectError || !project) return NextResponse.json({ error: "proposal_respond_failed" }, { status: 500 });
  const designerId = (project as { designer_id: string | null }).designer_id;
  try {
    // Первый ответ — финальный: повторные клики не перезаписывают решение.
    const { data: existing, error: existingError } = await admin
      .from("events")
      .select("type")
      .eq("project_id", projectId)
      .in("type", RESPONSE_TYPES)
      .order("created_at", { ascending: true })
      .limit(1);
    if (existingError) throw new Error("response_read_failed");
    const first = existing?.[0];
    if (first) {
      return NextResponse.json({ ok: true, response: first.type });
    }

    const recorded = await admin.from("events").insert({
      designer_id: designerId,
      project_id: projectId,
      type: eventType,
    });
    if (recorded.error) throw new Error("response_write_failed");

    if (eventType === "proposal_accepted") {
      const proposalUpdate = await admin.from("proposals").update({ status: "accepted" }).eq("id", (proposal as { id: string }).id);
      const projectUpdate = await admin.from("projects").update({ status: "proposal_accepted" }).eq("id", projectId);
      if (proposalUpdate.error || projectUpdate.error) throw new Error("response_update_failed");
    }

    return NextResponse.json({ ok: true, response: eventType });
  } catch {
    try {
      await admin.from("events").insert({ designer_id: designerId, project_id: projectId, type: "proposal_respond_failed" });
    } catch { /* Telemetry must not mask the operation failure. */ }
    return NextResponse.json({ error: "proposal_respond_failed" }, { status: 500 });
  }
}
