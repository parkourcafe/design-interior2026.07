import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// Установка пароля залогиненному дизайнеру через service-role
// (`updateUserById`) — в обход клиентской проверки «слабый/утёкший пароль».
// Пользователь может задать любой пароль от 6 символов.
export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Не авторизован." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 6) {
    return NextResponse.json({ error: "Пароль — минимум 6 символов." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(user.id, { password });
  if (error) {
    return NextResponse.json({ error: error.message || "Не удалось сохранить пароль." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
