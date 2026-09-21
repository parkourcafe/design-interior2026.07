import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { marketRoutingReceiptDigest, type MarketRoutingReceipt } from "./receipt";

export async function bindMarketRoutingReceipt(
  client: SupabaseClient,
  rawReceipt: string,
  receipt: MarketRoutingReceipt,
): Promise<void> {
  const { error } = await client.schema("projectceo_api").rpc("accept_market_routing_receipt", {
    p_market: receipt.market,
    p_receipt_digest: marketRoutingReceiptDigest(rawReceipt),
    p_declared_market: receipt.routingBasis.declaredMarket,
    p_reason: receipt.routingBasis.reason,
    p_russian_signal_kinds: [...receipt.routingBasis.russianSignals],
  });
  if (error) throw new Error("market_routing_binding_failed");
}
