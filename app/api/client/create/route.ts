import { NextRequest, NextResponse } from "next/server";
import {
  MARKET_ROUTING_COOKIE,
  MarketRoutingReceiptError,
  verifyMarketRoutingReceipt,
} from "@/lib/market/receipt";
import { formatIntakeLinkToken } from "@/lib/intake";
import { createRegionalPublicTokenClient } from "@/lib/supabase/regional-admin";
import { RegionalSupabaseConfigurationError } from "@/lib/supabase/cells";
import { makeToken } from "@/lib/tokens";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Клиентский бриф (вариант 2): создаём проект БЕЗ дизайнера. Клиент проходит
// бриф по возвращённому токену и потом сам рассылает публичную ссылку-бриф.
export async function POST(request: NextRequest) {
  // Не более 10 новых клиентских брифов с одного IP в час.
  if (!(await checkRateLimit("client_create", clientIp(request), 10, 60 * 60 * 1000))) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте позже." },
      { status: 429 },
    );
  }

  const rawReceipt = request.cookies.get(MARKET_ROUTING_COOKIE)?.value;
  let receipt;
  try {
    receipt = verifyMarketRoutingReceipt(rawReceipt);
  } catch (error) {
    const code = error instanceof MarketRoutingReceiptError ? error.message : "routing_receipt_invalid";
    return NextResponse.json({ error: code }, { status: 428 });
  }

  let admin;
  try {
    admin = createRegionalPublicTokenClient(receipt.cellCode, "client-bootstrap");
  } catch (error) {
    if (error instanceof RegionalSupabaseConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
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

  return NextResponse.json({ ok: true, token: formatIntakeLinkToken(receipt.cellCode, intakeToken) });
}
