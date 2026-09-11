export const MARKETS = Object.freeze(["ru", "international"] as const);
export const DATA_CELL_IDS = Object.freeze(["ru", "international"] as const);

export type Market = (typeof MARKETS)[number];
export type DataCellId = (typeof DATA_CELL_IDS)[number];

/** A data cell is an infrastructure boundary, not a legal jurisdiction. */
export interface DataCell {
  readonly id: DataCellId;
}

export interface MarketSignals {
  /** Explicit selection collected before any profile or project payload. */
  declaredMarket?: unknown;
  /** Trusted server-side country hint. Never accept this from form JSON. */
  trustedCountryCode?: unknown;
  /** Trusted ISO country for a verified phone. Do not infer this from +7 alone. */
  trustedPhoneCountryCode?: unknown;
  /** UI locale is a weak signal and can only make routing more conservative. */
  locale?: unknown;
}

export type RussianSignalKind =
  | "trusted_country"
  | "trusted_phone_country"
  | "locale";

export interface RoutingBasis {
  readonly declaredMarket: Market | null;
  readonly russianSignals: readonly RussianSignalKind[];
  readonly reason: "declared" | "conservative_ru_signal" | "conservative_default";
}

export interface MarketResolution {
  readonly market: Market;
  readonly dataCell: DataCell;
  /** Auditable basis without raw country, phone, IP or locale values. */
  readonly routingBasis: RoutingBasis;
}

const DATA_CELL_BY_MARKET: Readonly<Record<Market, DataCellId>> = Object.freeze({
  ru: "ru",
  international: "international",
});

export function parseMarket(value: unknown): Market | null {
  return typeof value === "string" && MARKETS.includes(value as Market)
    ? value as Market
    : null;
}

function normalized(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function russianSignalKinds(signals: MarketSignals): readonly RussianSignalKind[] {
  const kinds: RussianSignalKind[] = [];
  const country = normalized(signals.trustedCountryCode);
  const phoneCountry = normalized(signals.trustedPhoneCountryCode);
  const locale = normalized(signals.locale).replace("_", "-");
  if (country === "ru") kinds.push("trusted_country");
  if (phoneCountry === "ru") kinds.push("trusted_phone_country");
  if (locale === "ru" || locale.startsWith("ru-")) kinds.push("locale");
  return Object.freeze(kinds);
}

export function dataCellForMarket(market: unknown): DataCell {
  const parsed = parseMarket(market);
  if (!parsed) throw new Error("invalid_market");
  return Object.freeze({ id: DATA_CELL_BY_MARKET[parsed] });
}

/**
 * Conservative routing proxy. It does not determine citizenship or applicable
 * law. A Russian signal can move routing to RU; it can never downgrade RU.
 */
export function resolveMarket(signals: MarketSignals): MarketResolution {
  const declaredMarket = parseMarket(signals.declaredMarket);
  const russianSignals = russianSignalKinds(signals);
  const reason = declaredMarket === "ru"
    ? "declared"
    : russianSignals.length > 0
      ? "conservative_ru_signal"
      : declaredMarket === "international"
        ? "declared"
        : "conservative_default";
  const market: Market = reason === "declared" && declaredMarket === "international"
    ? "international"
    : "ru";
  return Object.freeze({
    market,
    dataCell: dataCellForMarket(market),
    routingBasis: Object.freeze({ declaredMarket, russianSignals, reason }),
  });
}
