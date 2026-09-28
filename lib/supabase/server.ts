import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { dashboardSessionCookieName } from "./session-cookie";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Server client bound to the request's auth cookies (anon key). Используется в
// server components / route handlers, где действия идут от имени залогиненного
// дизайнера и должны проходить через RLS.
export async function createClient() {
  const cookieStore = await cookies();
  const cookieName = dashboardSessionCookieName(cookieStore.getAll().map((cookie) => cookie.name));

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      ...(cookieName ? { cookieOptions: { name: cookieName } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // called from a Server Component — safe to ignore, middleware refreshes the session
          }
        },
      },
    },
  );
}
