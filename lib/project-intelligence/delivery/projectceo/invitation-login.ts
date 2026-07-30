const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVITATION_PATH_PATTERN = /^\/projectceo\/invitations\/[A-Za-z0-9_-]{43}$/;

/**
 * Login may return to one narrowly-scoped invitation path. Everything else
 * falls back to the authenticated dashboard, preventing an open redirect.
 */
export function safeProjectCeoLoginNext(search: string): string {
  const next = new URLSearchParams(search).get("next");
  return next && INVITATION_PATH_PATTERN.test(next) ? next : "/dashboard";
}

export function projectCeoInvitationLoginHref(token: string): string {
  if (!INVITATION_TOKEN_PATTERN.test(token)) return "/login";
  const next = `/projectceo/invitations/${token}`;
  return `/login?next=${encodeURIComponent(next)}`;
}
