import { NextRequest, NextResponse } from "next/server";
import {
  MARKET_ROUTING_COOKIE,
  MarketRoutingReceiptError,
  verifyMarketRoutingReceipt,
} from "@/lib/market/receipt";
import { createRegionalRouteClient } from "@/lib/supabase/regional";
import { RegionalSupabaseConfigurationError } from "@/lib/supabase/cells";
import { bindMarketRoutingReceipt } from "@/lib/market/bind";

export const dynamic = "force-dynamic";

function responseWithSessionCookies(
  source: NextResponse,
  body: Record<string, string>,
  status: number,
) {
  const response = NextResponse.json(body, { status });
  source.cookies.getAll().forEach((cookie) => response.cookies.set(cookie));
  return response;
}

/** Binds a browser-created Auth session to its previously selected data cell. */
export async function POST(request: NextRequest) {
  const rawReceipt = request.cookies.get(MARKET_ROUTING_COOKIE)?.value;
  let receipt;
  try {
    receipt = verifyMarketRoutingReceipt(rawReceipt);
  } catch (error) {
    const code = error instanceof MarketRoutingReceiptError ? error.message : "routing_receipt_invalid";
    return NextResponse.json({ error: code }, { status: 428 });
  }

  const response = NextResponse.json({ ok: true });
  let supabase;
  try {
    supabase = createRegionalRouteClient(receipt.cellCode, request, response);
  } catch (error) {
    if (error instanceof RegionalSupabaseConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return responseWithSessionCookies(response, { error: "auth_required" }, 401);
  try {
    await bindMarketRoutingReceipt(supabase, rawReceipt!, receipt);
  } catch {
    await supabase.auth.signOut();
    return responseWithSessionCookies(response, { error: "market_routing_binding_failed" }, 503);
  }
  return response;
}
