import { NextResponse } from "next/server";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
import { isPublicLinkActive } from "@/lib/proposal/public-link";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { canAdvanceProposalProjectStatus } from "@/lib/proposal/status";

export const dynamic = "force-dynamic";

// Ответ клиента на публичное КП: принять / обсудить / запросить правки.
// Ответ привязан к версии КП (proposal_responses, 20261001100000): одна версия —
// один ответ. Повтор того же ответа идемпотентен, другой ответ на ту же версию —
// 409 already_responded (не маскируется под успех). Ответ на версию, которую
// заменила более новая выданная версия, — 409 superseded.
// Это подтверждение намерения, не юридическая подпись (см. i18n respond.note).
import {
  ACTION_EVENT,
  hasNewerIssuedVersion,
  isResponseAction,
  normalizeResponseComment,
  readProposalResponse,
} from "@/lib/proposal/respond";

export async function POST(request: Request) {
  if (!(await checkRateLimit("proposal_respond", clientIp(request), 20, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { token?: unknown; action?: unknown; comment?: unknown };
  if (typeof body.token !== "string" || !body.token || !isResponseAction(body.action)) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const action = body.action;
  const eventType = ACTION_EVENT[action];
  const comment = normalizeResponseComment(action, body.comment);
  if (comment === "too_long") {
    return NextResponse.json({ error: "comment_too_long" }, { status: 400 });
  }

  const admin = createScopedServiceClient("proposal-response");
  const { data: proposal } = await admin
    .from("proposals")
    .select("id, project_id, version, status, sent_at, public_expires_at")
    .eq("public_token", body.token)
    .maybeSingle();

  // Отвечать можно только на отправленное КП; черновики не раскрываем.
  if (!proposal || !["sent", "accepted"].includes((proposal as { status?: string }).status ?? "")) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Истёкшая или отозванная ссылка не принимает ответ (20260928156000).
  if (!isPublicLinkActive((proposal as { public_expires_at?: string | null }).public_expires_at)) {
    return NextResponse.json({ error: "link_expired" }, { status: 410 });
  }
  const projectId = (proposal as { project_id: string }).project_id;
  const { data: project, error: projectError } = await admin.from("projects").select("designer_id, status").eq("id", projectId).maybeSingle();
  if (projectError || !project) return NextResponse.json({ error: "proposal_respond_failed" }, { status: 500 });
  const designerId = (project as { designer_id: string | null }).designer_id;
  // DEC-044 (a): аккаунт дизайнера в сроке удаления — КП только для чтения.
  // Проверка до записи события: база и так отклонит смену статуса КП, но
  // событие ответа не должно появиться вовсе.
  if (designerId) {
    const { data: inRetention, error: retentionError } = await admin.rpc("account_retention_active", {
      p_designer_id: designerId,
    });
    if (retentionError) return NextResponse.json({ error: "proposal_respond_failed" }, { status: 500 });
    if (inRetention === true) return NextResponse.json({ error: "proposal_archived" }, { status: 409 });
  }
  async function reconcileAcceptedState() {
    if ((proposal as { status?: string }).status === "sent") {
      const proposalUpdate = await admin.from("proposals").update({ status: "accepted" })
        .eq("id", (proposal as { id: string }).id).eq("status", "sent");
      if (proposalUpdate.error) throw new Error("response_proposal_update_failed");
    }
    const projectStatus = (project as { status?: string }).status ?? "";
    if (canAdvanceProposalProjectStatus(projectStatus, "proposal_accepted")) {
      const projectUpdate = await admin.from("projects").update({ status: "proposal_accepted" })
        .eq("id", projectId).eq("status", projectStatus);
      if (projectUpdate.error) throw new Error("response_project_update_failed");
    }
  }
  const issued = proposal as { id: string; project_id: string; version: number; sent_at?: string | null };
  try {
    // Клиент открыл старую ссылку, а дизайнер уже выпустил новую версию.
    if (await hasNewerIssuedVersion(admin, issued)) {
      return NextResponse.json({ error: "superseded" }, { status: 409 });
    }

    const respondExisting = async (existing: string) => {
      if (existing !== eventType) {
        return NextResponse.json({ error: "already_responded", response: existing }, { status: 409 });
      }
      if (existing === "proposal_accepted") await reconcileAcceptedState();
      return NextResponse.json({ ok: true, response: existing });
    };

    const existing = await readProposalResponse(admin, issued);
    if (existing.eventType) return await respondExisting(existing.eventType);

    const recorded = await admin.from("proposal_responses").insert({
      proposal_id: issued.id,
      project_id: projectId,
      proposal_version: issued.version,
      action,
      comment,
    });
    if (recorded.error) {
      // Параллельный ответ на ту же версию: решение уже записано другим запросом.
      if ((recorded.error as { code?: string }).code === "23505") {
        const raced = await readProposalResponse(admin, issued);
        if (raced.eventType) return await respondExisting(raced.eventType);
      }
      throw new Error("response_write_failed");
    }

    const event = await admin.from("events").insert({
      designer_id: designerId,
      project_id: projectId,
      type: eventType,
    });
    if (event.error) throw new Error("response_event_write_failed");

    if (eventType === "proposal_accepted") {
      await reconcileAcceptedState();
    }

    return NextResponse.json({ ok: true, response: eventType });
  } catch {
    try {
      await admin.from("events").insert({ designer_id: designerId, project_id: projectId, type: "proposal_respond_failed" });
    } catch { /* Telemetry must not mask the operation failure. */ }
    return NextResponse.json({ error: "proposal_respond_failed" }, { status: 500 });
  }
}
