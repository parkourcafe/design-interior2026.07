import { NextResponse } from "next/server";
import { z } from "zod";
import { createScopedServiceClient } from "@/lib/supabase/token-scoped";
import { isRoomClosed, type RoomClosureClient } from "@/lib/project-room/closed";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

// «Получил комплект» — исполнитель по своей ссылке комнаты. Один раз на комплект:
// повтор возвращает ту же отметку (идемпотентно), другие роли — 403.
const Body = z.object({ token: z.string().min(16) });

export async function POST(request: Request) {
  if (!(await checkRateLimit("project_room_kit_receipt", clientIp(request), 30, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const admin = createScopedServiceClient("participant-kit-receipt");
  const { data: participant } = await admin.from("project_participants").select("id, room_id, role")
    .eq("access_token", parsed.data.token).maybeSingle();
  if (!participant) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const p = participant as { id: string; room_id: string; role: string };
  // DEC-047 (g): комната студии, запросившей удаление аккаунта, закрыта.
  if (await isRoomClosed(admin as unknown as RoomClosureClient, p.room_id)) {
    return NextResponse.json({ error: "room_closed" }, { status: 410 });
  }
  if (p.role !== "executor") return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data: kit } = await admin.from("project_handover_kits").select("id, proposal_version")
    .eq("room_id", p.room_id).maybeSingle();
  if (!kit) return NextResponse.json({ error: "no_kit" }, { status: 404 });
  const kitId = (kit as { id: string }).id;

  const read = async () => (await admin.from("project_handover_receipts").select("received_at")
    .eq("kit_id", kitId).eq("participant_id", p.id).maybeSingle()).data as { received_at: string } | null;
  const already = await read();
  if (already) return NextResponse.json({ ok: true, receivedAt: already.received_at, replay: true });

  const { error } = await admin.from("project_handover_receipts").insert({ kit_id: kitId, participant_id: p.id });
  if (error && (error as { code?: string }).code !== "23505") {
    return NextResponse.json({ error: "receipt_failed" }, { status: 500 });
  }
  const receipt = await read();
  if (!receipt) return NextResponse.json({ error: "receipt_failed" }, { status: 500 });
  if (!error) {
    await admin.from("project_task_events").insert({
      room_id: p.room_id, actor_role: "executor", event_type: "handover_kit_received",
      details: { proposal_version: (kit as { proposal_version: number }).proposal_version },
    });
  }
  return NextResponse.json({ ok: true, receivedAt: receipt.received_at, replay: Boolean(error) });
}
