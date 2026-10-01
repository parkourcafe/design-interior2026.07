import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Статус заявки на удаление аккаунта (DEC-047). Сам дизайнер удаление не
// отменяет — только поддержка до уничтожения; POST оставлен для старых
// клиентов и получает отказ базы.

async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  const { data, error } = await supabase.rpc("get_account_retention_status");
  if (error) return NextResponse.json({ error: "Не удалось получить статус." }, { status: 500 });
  return NextResponse.json({ retention: data ?? null });
}

export async function POST() {
  const { supabase, user } = await currentUser();
  if (!user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });
  const { data, error } = await supabase.rpc("cancel_account_deletion", { p_reason: null });
  if (error) {
    const message = String(error.message ?? "");
    const reason = message.includes("ACCOUNT_RETENTION_CANCEL_VIA_SUPPORT") || /permission denied/i.test(message)
      ? "cancel_via_support"
      : message.includes("ACCOUNT_RETENTION_LEGAL_HOLD")
      ? "legal_hold"
      : message.includes("ACCOUNT_RETENTION_WINDOW_CLOSED")
        ? "window_closed"
        : message.includes("ACCOUNT_RETENTION_NO_ACTIVE_CASE")
          ? "no_active_case"
          : "failed";
    return NextResponse.json({ error: reason }, { status: reason === "failed" ? 500 : 409 });
  }
  return NextResponse.json({ ok: true, retention: data ?? null });
}
