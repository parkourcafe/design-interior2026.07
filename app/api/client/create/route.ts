import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { makeToken } from "@/lib/tokens";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Клиентский бриф (вариант 2): создаём проект БЕЗ дизайнера. Клиент проходит
// бриф по возвращённому токену и потом сам рассылает публичную ссылку-бриф.
export async function POST(request: Request) {
  // Не более 10 новых клиентских брифов с одного IP в час.
  if (!(await checkRateLimit("client_create", clientIp(request), 10, 60 * 60 * 1000))) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте позже." },
      { status: 429 },
    );
  }

  const admin = createAdminClient();
  const intakeToken = makeToken();

  const { data, error } = await admin
    .from("projects")
    .insert({
      designer_id: null,
      client_name: "",
      status: "created",
      intake_token: intakeToken,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "insert_failed" },
      { status: 500 },
    );
  }

  await admin.from("events").insert({
    designer_id: null,
    project_id: data.id,
    type: "intake_link_created",
  });

  return NextResponse.json({ ok: true, token: intakeToken });
}
