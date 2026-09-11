import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  MarketRoutingReceiptError,
  createMarketRoutingReceipt,
  marketRoutingReceiptDigest,
  verifyMarketRoutingReceipt,
} from "@/lib/market/receipt";
import { RegionalSupabaseConfigurationError, regionalSupabaseConfig } from "@/lib/supabase/cells";
import { formatIntakeLinkToken, parseIntakeLinkToken } from "@/lib/intake";

const originalSecret = process.env.REGIONAL_ROUTING_RECEIPT_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.REGIONAL_ROUTING_RECEIPT_SECRET;
  else process.env.REGIONAL_ROUTING_RECEIPT_SECRET = originalSecret;
});

describe("market routing receipt", () => {
  it("retains only a PII-free routing basis and maps international to the US cell", () => {
    process.env.REGIONAL_ROUTING_RECEIPT_SECRET = "test-routing-secret-with-at-least-thirty-two-bytes";
    const token = createMarketRoutingReceipt({ declaredMarket: "international", locale: "en-US" }, 1_000);
    const receipt = verifyMarketRoutingReceipt(token, 1_100);

    expect(receipt).toMatchObject({
      version: 1,
      market: "international",
      cellCode: "us",
      routingBasis: { declaredMarket: "international", russianSignals: [], reason: "declared" },
    });
    expect(JSON.stringify(receipt)).not.toContain("en-US");
    expect(marketRoutingReceiptDigest(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a forged or expired receipt", () => {
    process.env.REGIONAL_ROUTING_RECEIPT_SECRET = "test-routing-secret-with-at-least-thirty-two-bytes";
    const token = createMarketRoutingReceipt({ declaredMarket: "ru" }, 1_000);
    expect(() => verifyMarketRoutingReceipt(`${token}x`, 1_100))
      .toThrow(new MarketRoutingReceiptError("routing_receipt_invalid"));
    expect(() => verifyMarketRoutingReceipt(token, 5_000))
      .toThrow(new MarketRoutingReceiptError("routing_receipt_expired"));
  });

  it("fails closed when a cell has no complete public configuration", () => {
    const environment = {
      NEXT_PUBLIC_SUPABASE_URL: "https://ru.example.test",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "ru-public-key",
    } as unknown as NodeJS.ProcessEnv;
    expect(regionalSupabaseConfig("ru", environment)).toMatchObject({
      cellCode: "ru",
      cookieName: "sb-remhaos-ru-auth-token",
    });
    expect(() => regionalSupabaseConfig("us", environment)).toThrow(RegionalSupabaseConfigurationError);
  });

  it("uses a PII-free cell prefix before resolving an unauthenticated intake link", () => {
    const opaque = "A".repeat(24);
    expect(formatIntakeLinkToken("us", opaque)).toBe(`us.${opaque}`);
    expect(parseIntakeLinkToken(`us.${opaque}`)).toEqual({ cellCode: "us", token: opaque });
    expect(parseIntakeLinkToken(opaque)).toEqual({ cellCode: "ru", token: opaque });
    expect(parseIntakeLinkToken(`international.${opaque}`)).toBeNull();
  });
});
