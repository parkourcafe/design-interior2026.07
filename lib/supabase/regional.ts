import { createBrowserClient, createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import type { DataCellId } from "@/lib/market/contract";
import { regionalSupabaseConfig } from "./cells";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

export function createRegionalBrowserClient(cellCode: DataCellId) {
  const config = regionalSupabaseConfig(cellCode);
  return createBrowserClient(config.url, config.publishableKey, {
    cookieOptions: { name: config.cookieName },
  });
}

export function createRegionalRouteClient(
  cellCode: DataCellId,
  request: NextRequest,
  response: NextResponse,
) {
  const config = regionalSupabaseConfig(cellCode);
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: { name: config.cookieName },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
}
