// Имя куки сессии дизайнера для кабинета.
//
// Вход через /login, регистрация и /auth/callback с квитанцией рынка пишут
// сессию под региональным именем `sb-remhaos-<cell>-auth-token`
// (lib/supabase/regional.ts). Старые аккаунты и ссылки без квитанции — под
// стандартным именем Supabase. Кабинет обслуживает RU-контур
// (NEXT_PUBLIC_SUPABASE_URL), поэтому читает RU-куку, а если её нет —
// стандартную. Раньше кабинет знал только стандартное имя: после любого нового
// входа proxy.ts не видел сессию и возвращал дизайнера на /login.
//
// Куки @supabase/ssr бывают разбиты на части: `<name>.0`, `<name>.1`, …

export const DASHBOARD_REGIONAL_SESSION_COOKIE = "sb-remhaos-ru-auth-token";

export function dashboardSessionCookieName(cookieNames: Iterable<string>): string | undefined {
  for (const name of cookieNames) {
    if (name === DASHBOARD_REGIONAL_SESSION_COOKIE || name.startsWith(`${DASHBOARD_REGIONAL_SESSION_COOKIE}.`)) {
      return DASHBOARD_REGIONAL_SESSION_COOKIE;
    }
  }
  return undefined;
}

/** Имена кук из `document.cookie` (браузер). */
export function documentCookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(";")
    .map((part) => part.split("=")[0]?.trim() ?? "")
    .filter(Boolean);
}
