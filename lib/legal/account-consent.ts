/** Application HTTP boundaries only; Supabase's public upstream is separate. */
export function accountConsentProtected(path: string, method = "GET"): boolean {
  if (/^\/api\/integrations\/[^/]+\/webhook\/?$/.test(path)) return false;
  if (/^\/join\/[^/]+\/?$/.test(path)) return method !== "GET" && method !== "HEAD";
  return ["/dashboard", "/api/projectceo", "/api/dashboard", "/api/layout-studio", "/api/brief/custom-question", "/api/projects", "/api/integrations"]
    .some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function accountConsentNext(value: string | null): string {
  return value && /^\/(?![/\\])/.test(value) && !value.startsWith("/auth/consent") ? value : "/dashboard";
}

export function accountConsentDestination(next: string): string {
  return `/auth/consent?next=${encodeURIComponent(accountConsentNext(next))}`;
}
