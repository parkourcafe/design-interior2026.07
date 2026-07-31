// Общая логика приглашения в студию по ссылке-токену (`studio_members`,
// миграция 0007_invite_tokens.sql). Вынесена из app/join/[token]/actions.ts
// и page.tsx: одна и та же проверка истечения нужна и для активации, и для
// показа страницы — раньше была продублирована в обоих местах.
export function isInviteExpired(tokenExpiresAt: string | null): boolean {
  if (!tokenExpiresAt) return false;
  return new Date(tokenExpiresAt).getTime() < Date.now();
}
