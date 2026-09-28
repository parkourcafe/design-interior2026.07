"use client";

import { createBrowserClient } from "@supabase/ssr";
import { dashboardSessionCookieName, documentCookieNames } from "./session-cookie";

// Browser client — anon key only. RLS enforces что дизайнер видит только свои проекты.
// Имя куки — как у кабинета на сервере (lib/supabase/session-cookie.ts), иначе
// «Выйти» не видит региональную сессию и не завершает её.
export function createClient() {
  const cookieName = typeof document === "undefined"
    ? undefined
    : dashboardSessionCookieName(documentCookieNames(document.cookie));
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    cookieName ? { cookieOptions: { name: cookieName } } : undefined,
  );
}
