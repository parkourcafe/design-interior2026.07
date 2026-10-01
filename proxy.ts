import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { dashboardSessionCookieName } from "@/lib/supabase/session-cookie";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Обновляет сессию Supabase на каждом запросе к кабинету дизайнера и
// защищает /dashboard: без сессии — редирект на /login.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const cookieName = dashboardSessionCookieName(request.cookies.getAll().map((cookie) => cookie.name));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
    {
      ...(cookieName ? { cookieOptions: { name: cookieName } } : {}),
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
    return NextResponse.redirect(url);
  }

  // DEC-047: после запроса удаления кабинет закрыт на каждом запросе,
  // включая клиентские переходы, а не только при полной загрузке страницы.
  if (isAuthenticated && request.nextUrl.pathname.startsWith("/dashboard")) {
    const { data: retention } = await supabase.rpc("get_account_retention_status");
    const state = retention as { status?: string; closed?: boolean } | null;
    if (state?.closed === true || state?.status === "expired") {
      const url = request.nextUrl.clone();
      url.pathname = "/account-closed";
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  // Только кабинет дизайнера. Публичные маршруты (/i, /p, /api) не трогаем.
  matcher: ["/dashboard/:path*"],
};
