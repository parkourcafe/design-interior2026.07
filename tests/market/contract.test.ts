import { describe, expect, it } from "vitest";
import { DATA_CELL_IDS, MARKETS, dataCellForMarket, parseMarket, resolveMarket } from "@/lib/market/contract";
import { assertProviderAllowed, regionalPolicy } from "@/lib/market/policy";

describe("market routing contract", () => {
  it("accepts only canonical market values", () => {
    expect(parseMarket("ru")).toBe("ru");
    expect(parseMarket("international")).toBe("international");
    expect(parseMarket("us")).toBeNull();
    expect(parseMarket("RU")).toBeNull();
  });

  it("does not allow runtime mutation of canonical market and cell registries", () => {
    expect(Object.isFrozen(MARKETS)).toBe(true);
    expect(Object.isFrozen(DATA_CELL_IDS)).toBe(true);
    expect(() => (MARKETS as unknown as string[]).push("us")).toThrow(TypeError);
    expect(parseMarket("us")).toBeNull();
  });

  it("uses RU when no explicit routing basis exists", () => {
    expect(resolveMarket({})).toMatchObject({
      market: "ru",
      dataCell: { id: "ru" },
      routingBasis: { declaredMarket: null, reason: "conservative_default" },
    });
    expect(resolveMarket({ declaredMarket: "unknown" }).market).toBe("ru");
  });

  it("honors explicit international selection without Russian signals", () => {
    expect(resolveMarket({ declaredMarket: "international", locale: "en-US" }))
      .toMatchObject({
        market: "international",
        dataCell: { id: "us" },
        routingBasis: { declaredMarket: "international", reason: "declared" },
      });
  });

  it.each([
    ["trusted_country", { trustedCountryCode: "RU" }],
    ["trusted_phone_country", { trustedPhoneCountryCode: "RU" }],
    ["locale", { locale: "ru-RU" }],
  ])("records the %s basis when a Russian signal overrides a declaration", (kind, signal) => {
    expect(resolveMarket({ declaredMarket: "international", ...signal }))
      .toMatchObject({
        market: "ru",
        dataCell: { id: "ru" },
        routingBasis: {
          declaredMarket: "international",
          russianSignals: [kind],
          reason: "conservative_ru_signal",
        },
      });
  });

  it("does not treat the shared +7 prefix as proof of a Russian phone", () => {
    expect(resolveMarket({ declaredMarket: "international", trustedPhoneCountryCode: "+7" }).market)
      .toBe("international");
  });

  it("maps a project to exactly one validated cell", () => {
    expect(dataCellForMarket("ru")).toEqual({ id: "ru" });
    expect(dataCellForMarket("international")).toEqual({ id: "us" });
    expect(() => dataCellForMarket("us")).toThrow("invalid_market");
  });
});

describe("regional provider policy", () => {
  it("keeps data-cell policy separate from locale, currency and legal jurisdiction", () => {
    expect(regionalPolicy("ru")).toMatchObject({ dataCell: { id: "ru" } });
    expect(regionalPolicy("international")).toMatchObject({ dataCell: { id: "us" } });
    expect(regionalPolicy("international")).not.toHaveProperty("currency");
    expect(regionalPolicy("international")).not.toHaveProperty("legalDocumentSet");
  });

  it("returns deeply immutable policy values", () => {
    const policy = regionalPolicy("ru");
    expect(Object.isFrozen(policy)).toBe(true);
    expect(Object.isFrozen(policy.dataCell)).toBe(true);
    expect(Object.isFrozen(policy.allowedLlmProviders)).toBe(true);
  });

  it("prevents a foreign provider in the RU cell", () => {
    expect(assertProviderAllowed("ru", "yandex")).toBe("yandex");
    expect(assertProviderAllowed("ru", "gigachat")).toBe("gigachat");
    expect(() => assertProviderAllowed("ru", "zai")).toThrow("provider_not_allowed_for_market");
  });

  it("keeps international AI disabled until a provider decision exists", () => {
    expect(regionalPolicy("international").allowedLlmProviders).toEqual([]);
    expect(() => assertProviderAllowed("international", "zai"))
      .toThrow("provider_not_allowed_for_market");
  });

  it("fails closed for unknown markets and providers", () => {
    expect(() => regionalPolicy("us")).toThrow("invalid_market");
    expect(() => assertProviderAllowed("international", "openai"))
      .toThrow("provider_not_allowed_for_market");
  });
});
