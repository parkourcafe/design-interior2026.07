import { dataCellForMarket, parseMarket, type DataCell, type Market } from "./contract";

export type LlmProviderName = "yandex" | "gigachat" | "zai";

export interface RegionalPolicy {
  readonly market: Market;
  readonly dataCell: DataCell;
  readonly allowedLlmProviders: readonly LlmProviderName[];
}

const POLICIES: Readonly<Record<Market, RegionalPolicy>> = Object.freeze({
  ru: Object.freeze({
    market: "ru",
    dataCell: dataCellForMarket("ru"),
    allowedLlmProviders: Object.freeze(["yandex", "gigachat"] as LlmProviderName[]),
  }),
  international: Object.freeze({
    market: "international",
    dataCell: dataCellForMarket("international"),
    // No international provider is approved for activation yet.
    allowedLlmProviders: Object.freeze([] as LlmProviderName[]),
  }),
});

export function regionalPolicy(market: unknown): RegionalPolicy {
  const parsed = parseMarket(market);
  if (!parsed) throw new Error("invalid_market");
  return POLICIES[parsed];
}

export function assertProviderAllowed(market: unknown, provider: unknown): LlmProviderName {
  const policy = regionalPolicy(market);
  if (typeof provider !== "string" ||
      !policy.allowedLlmProviders.includes(provider as LlmProviderName)) {
    throw new Error("provider_not_allowed_for_market");
  }
  return provider as LlmProviderName;
}
