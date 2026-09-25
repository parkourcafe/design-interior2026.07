import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { DataCellId } from "@/lib/market/contract";
import { regionalServiceConfig } from "./cells";

const publicTokenPurposes = new Set([
  "intake-start",
  "intake-submit",
  "intake-upload",
  "client-bootstrap",
  "public-intake-read",
] as const);

export type RegionalPublicTokenPurpose = typeof publicTokenPurposes extends Set<infer Purpose>
  ? Purpose
  : never;

/** The caller supplies no cell or credentials: the server derives the cell. */
export function createRegionalPublicTokenClient(
  cellCode: DataCellId,
  purpose: RegionalPublicTokenPurpose,
) {
  if (typeof window !== "undefined" || !publicTokenPurposes.has(purpose)) {
    throw new Error("regional_service_role_purpose_not_allowed");
  }
  const config = regionalServiceConfig(cellCode);
  return createSupabaseClient(config.url, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
