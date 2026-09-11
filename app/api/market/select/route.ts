import { NextRequest, NextResponse } from "next/server";
import {
  MARKET_ROUTING_COOKIE,
  MarketRoutingReceiptError,
  createMarketRoutingReceipt,
  marketReceiptCookieOptions,
  marketReceiptSignals,
} from "@/lib/market/receipt";
import { parseMarket } from "@/lib/market/contract";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { market?: unknown };
  if (!parseMarket(body.market)) {
    return NextResponse.json({ error: "invalid_market" }, { status: 400 });
  }

  try {
    const receipt = createMarketRoutingReceipt(marketReceiptSignals(request, body.market));
    const response = NextResponse.json({ ok: true });
    response.cookies.set(MARKET_ROUTING_COOKIE, receipt, marketReceiptCookieOptions());
    return response;
  } catch (error) {
    if (error instanceof MarketRoutingReceiptError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
}
