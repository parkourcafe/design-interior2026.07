import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Стабильная точка входа мобильных оболочек. Она не показывает маркетинговый
 * лендинг: действующая сессия сразу открывает кабинет, новая — форму входа.
 */
export default async function MobileAppEntryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  redirect(user ? "/dashboard" : "/login");
}
