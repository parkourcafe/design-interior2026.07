// Клиентская ссылка на КП действует ограниченное время (миграция 20260928156000):
// 90 дней после отправки, дизайнер может продлить или отозвать. NULL — КП ещё не
// отправлено или база без этой миграции: такую ссылку не считаем истёкшей.
export const PUBLIC_LINK_DAYS = 90;

export function isPublicLinkActive(expiresAt: string | null | undefined, now = new Date()): boolean {
  if (!expiresAt) return true;
  const time = Date.parse(expiresAt);
  return Number.isNaN(time) ? false : time > now.getTime();
}

export function extendedPublicLinkExpiry(now = new Date()): string {
  return new Date(now.getTime() + PUBLIC_LINK_DAYS * 24 * 60 * 60 * 1000).toISOString();
}
