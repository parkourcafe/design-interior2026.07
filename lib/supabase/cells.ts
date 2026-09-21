import { dataCellForMarket, type DataCellId, type Market } from "@/lib/market/contract";

export interface RegionalSupabaseConfig {
  readonly cellCode: DataCellId;
  readonly url: string;
  readonly publishableKey: string;
  readonly cookieName: string;
}

export interface RegionalServiceConfig extends RegionalSupabaseConfig {
  readonly serviceRoleKey: string;
}

export class RegionalSupabaseConfigurationError extends Error {
  constructor() {
    super("regional_cell_not_configured");
  }
}

function value(source: NodeJS.ProcessEnv, name: string): string | null {
  const candidate = source[name]?.trim();
  return candidate ? candidate : null;
}

export function regionalSupabaseConfig(
  cellCode: DataCellId,
  source: NodeJS.ProcessEnv = process.env,
): RegionalSupabaseConfig {
  const suffix = cellCode === "ru" ? "" : "_US";
  const url = value(source, `NEXT_PUBLIC_SUPABASE_URL${suffix}`);
  const publishableKey = value(source, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY${suffix}`)
    ?? value(source, `NEXT_PUBLIC_SUPABASE_ANON_KEY${suffix}`);
  if (!url || !publishableKey) throw new RegionalSupabaseConfigurationError();
  return Object.freeze({
    cellCode,
    url,
    publishableKey,
    cookieName: `sb-remhaos-${cellCode}-auth-token`,
  });
}

export function regionalSupabaseConfigForMarket(market: Market): RegionalSupabaseConfig {
  return regionalSupabaseConfig(dataCellForMarket(market).id);
}

/** Server-only configuration for an explicitly scoped public-token exception. */
export function regionalServiceConfig(
  cellCode: DataCellId,
  source: NodeJS.ProcessEnv = process.env,
): RegionalServiceConfig {
  const config = regionalSupabaseConfig(cellCode, source);
  const suffix = cellCode === "ru" ? "" : "_US";
  const serviceRoleKey = value(source, `SUPABASE_SERVICE_ROLE_KEY${suffix}`);
  if (!serviceRoleKey) throw new RegionalSupabaseConfigurationError();
  return Object.freeze({ ...config, serviceRoleKey });
}
