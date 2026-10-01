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

// Next.js подставляет в браузерную сборку только СТАТИЧЕСКИЕ обращения
// `process.env.NEXT_PUBLIC_…`. Динамическое `source[name]` в браузере читает
// пустой объект, и вход дизайнера (пароль, код на почту) падал с
// regional_cell_not_configured. Публичные значения перечислены явно; серверные
// ключи (service role) сюда не попадают и читаются только на сервере.
const PUBLIC_REGIONAL_ENV: Readonly<Record<string, string | undefined>> = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SUPABASE_URL_US: process.env.NEXT_PUBLIC_SUPABASE_URL_US,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_US: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_US,
  NEXT_PUBLIC_SUPABASE_ANON_KEY_US: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_US,
};

function value(source: NodeJS.ProcessEnv, name: string): string | null {
  const candidate = source[name]?.trim();
  return candidate ? candidate : null;
}

export function regionalSupabaseConfig(
  cellCode: DataCellId,
  source: NodeJS.ProcessEnv = { ...PUBLIC_REGIONAL_ENV, ...process.env },
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
