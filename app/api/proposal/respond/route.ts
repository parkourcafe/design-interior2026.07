import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { ACTION_EVENT } from "@/lib/proposal/respond";

export const dynamic = "force-dynamic";

// Ответ клиента на публичное КП: принять / обсудить / запросить правки.
// Источник истины — proposals.client_response (migration 0007, S3 «Лестницы
// запуска»). Первый ответ финальный: атомарный UPDATE ... WHERE
// client_response IS NULL — при одновременных кликах выигрывает один запрос,
// без гонки select-затем-insert. Событие в `events` пишется дополнительно —
// исторический лог. Это подтверждение намерения, не юридическая подпись
// (см. i18n respond.note).
export async function POST(request: Request) {
  if (!(await checkRateLimit("proposal_respond", clientIp(request), 20, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = (await request.json().catch(() => ({}))) as { token?: string; action?: string };
  const responseValue = body.action ? ACTION_EVENT[body.action] : undefined;
  if (!body.token || !responseValue) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: proposal } = await admin
    .from("proposals")
    .select("project_id, status, client_response")
    .eq("public_token", body.token)
    .maybeSingle();

  // Отвечать можно только на отправленное КП; черновики не раскрываем.
  if (!proposal || (proposal as { status?: string }).status !== "sent") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const existingResponse = (proposal as { client_response?: string | null }).client_response;
  if (existingResponse) {
    return NextResponse.json({ ok: true, response: existingResponse });
  }

  const { data: updated } = await admin
    .from("proposals")
    .update({ client_response: responseValue, client_response_at: new Date().toISOString() })
    .eq("public_token", body.token)
    .is("client_response", null)
    .select("client_response")
    .maybeSingle();

  if (!updated) {
    // Гонку с параллельным кликом проиграли — вернуть то, что уже записано.
    const { data: after } = await admin
      .from("proposals")
      .select("client_response")
      .eq("public_token", body.token)
      .maybeSingle();
    const finalResponse = (after as { client_response?: string | null } | null)?.client_response ?? responseValue;
    return NextResponse.json({ ok: true, response: finalResponse });
  }

  const projectId = (proposal as { project_id: string }).project_id;
  const { data: project } = await admin
    .from("projects")
    .select("designer_id")
    .eq("id", projectId)
    .maybeSingle();

  await admin.from("events").insert({
    designer_id: (project as { designer_id?: string | null } | null)?.designer_id ?? null,
    project_id: projectId,
    type: responseValue,
  });

  return NextResponse.json({ ok: true, response: responseValue });
}
