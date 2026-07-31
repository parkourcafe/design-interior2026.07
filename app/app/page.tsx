import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Всегда редирект — индексировать нечего.
export const metadata: Metadata = { robots: { index: false, follow: false } };

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
