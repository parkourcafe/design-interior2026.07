import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseConfig } from "@/lib/supabase/config";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Server client bound to the request's auth cookies (anon key). Используется в
// server components / route handlers, где действия идут от имени залогиненного
// дизайнера и должны проходить через RLS.
export async function createClient() {
  const cookieStore = await cookies();
  const { url, publishableKey } = getSupabaseConfig();

  return createServerClient(
    url,
    publishableKey,
    {
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
