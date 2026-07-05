import { createAdminClient } from "@/lib/supabase/admin";

// IP клиента из заголовков прокси (Vercel ставит x-forwarded-for).
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// Durable rate limit по ключу «action:ip» в скользящем окне.
// Возвращает true, если запрос разрешён (лимит не превышен).
//
// FAIL-OPEN: при любой ошибке (например, таблица rate_limits ещё не создана —
// миграция 0005 не применена) пропускаем запрос. Лимит — защита от абьюза,
// он не должен ронять продукт.
export async function checkRateLimit(
  action: string,
  ip: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const key = `${action}:${ip}`;
    const since = new Date(Date.now() - windowMs).toISOString();

    const { count, error } = await admin
      .from("rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("key", key)
      .gte("created_at", since);

    if (error) return true; // fail-open
    if ((count ?? 0) >= limit) return false;

    await admin.from("rate_limits").insert({ key });
    return true;
  } catch {
    return true; // fail-open
  }
}
