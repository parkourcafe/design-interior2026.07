import { createScopedServiceClient } from "@/lib/supabase/token-scoped";

// IP клиента из заголовков прокси (Vercel ставит x-forwarded-for).
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

// PostgREST: функция не найдена в кэше схемы (база ещё без миграции 20260928151000).
const FUNCTION_MISSING = new Set(["PGRST202", "42883"]);

// Durable rate limit по ключу «action:ip» в скользящем окне.
// Возвращает true, если запрос разрешён (лимит не превышен).
//
// Проверка и учёт — одной функцией базы `consume_rate_limit` под замком: две
// одновременные попытки не проходят обе. Ошибка базы — отказ (fail-closed):
// раньше любая ошибка пропускала запрос, а таблицы в миграциях не было, и
// лимит на окружениях из репозитория не работал вовсе.
//
// Переходный случай: база, где функции ещё нет (историческая схема), —
// прежняя проверка по таблице, с прежним поведением «пропустить при ошибке»,
// чтобы выкладка кода раньше миграции не закрыла приём брифов.
export async function checkRateLimit(
  action: string,
  ip: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const key = `${action}:${ip}`.slice(0, 300);
  try {
    const admin = createScopedServiceClient("system-rate-limit");
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_key: key,
      p_window_seconds: Math.max(1, Math.min(86_400, Math.round(windowMs / 1000))),
      p_max: limit,
    });
    if (!error) return data === true;
    if (!FUNCTION_MISSING.has(String(error.code ?? ""))) return false;
    return await legacyCheck(admin, key, limit, windowMs);
  } catch {
    return false;
  }
}

async function legacyCheck(
  admin: ReturnType<typeof createScopedServiceClient>,
  key: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - windowMs).toISOString();
    const { count, error } = await admin
      .from("rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("key", key)
      .gte("created_at", since);
    if (error) return true;
    if ((count ?? 0) >= limit) return false;
    await admin.from("rate_limits").insert({ key });
    return true;
  } catch {
    return true;
  }
}
