import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Заявка на пилот: фиксируем факт интереса событием pilot_request (метрика
// валидации). Содержимое заявки клиент отправляет письмом/копирует сам —
// таблицы лидов в v0.1 нет, и хранить PII без неё мы не хотим.
export async function POST(request: Request) {
  if (!(await checkRateLimit("pilot_request", clientIp(request), 10, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const admin = createAdminClient();
  await admin.from("events").insert({
    designer_id: null,
    project_id: null,
    type: "pilot_request",
  });

  return NextResponse.json({ ok: true });
}
