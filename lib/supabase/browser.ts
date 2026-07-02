"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser client — anon key only. RLS enforces что дизайнер видит только свои проекты.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
