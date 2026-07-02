import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service-role client — SERVER ONLY. Обходит RLS. Используется исключительно в
// публичных server routes (intake / публичное КП), где доступ авторизуется
// сверкой токена на сервере, а не сессией пользователя. Никогда не импортировать
// в клиентский код.
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
