import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { consentEnabled } from "@/lib/legal/consent-policy";
import { accountConsentProtected, accountConsentDestination } from "@/lib/legal/account-consent";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Обновляет сессию Supabase на каждом запросе к кабинету дизайнера и
// защищает /dashboard: без сессии — редирект на /login.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const protectedConsentRoute = consentEnabled() && accountConsentProtected(request.nextUrl.pathname, request.method);
  if (!protectedConsentRoute && !request.nextUrl.pathname.startsWith("/dashboard")) return response;
  function withSessionCookies(result: NextResponse) {
    response.cookies.getAll().forEach((cookie) => result.cookies.set(cookie));
    result.headers.set("Cache-Control", "no-store");
    return result;
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[], headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([name, value]) =>
            response.headers.set(name, value),
          );
        },
      },
    },
  );

  // Server-side route protection must validate the JWT signature. getSession()
  // only reads cookies and getUser() makes an avoidable Auth round-trip; the
  // current Supabase SSR contract uses getClaims() here.
  const { data, error } = await supabase.auth.getClaims();
  const isAuthenticated = !error && Boolean(data?.claims?.sub);

  if (!isAuthenticated && request.nextUrl.pathname.startsWith("/dashboard")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return withSessionCookies(NextResponse.redirect(url));
  }

  if (protectedConsentRoute) {
    const api = request.nextUrl.pathname.startsWith("/api/");
    if (!isAuthenticated) return withSessionCookies(NextResponse.json({ error: "unauthenticated" }, { status: 401 }));
    try {
      const { data: accepted, error: consentError } = await supabase.rpc("has_my_consent");
      if (consentError) throw new Error("consent_unavailable");
      if (accepted !== true) {
        if (api || request.method !== "GET") return withSessionCookies(NextResponse.json({ error: "consent_required" }, { status: 403 }));
        return withSessionCookies(NextResponse.redirect(new URL(accountConsentDestination(request.nextUrl.pathname + request.nextUrl.search), request.url)));
      }
    } catch {
      return withSessionCookies(NextResponse.json({ error: "consent_unavailable" }, { status: 503 }));
    }
  }
  return response;
}

export const config = {
  // Public/system routes return before creating an Auth client.
  matcher: ["/dashboard/:path*", "/api/:path*", "/join/:path*"],
};
