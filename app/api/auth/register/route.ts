import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Регистрация по email+паролю БЕЗ письма-подтверждения и без зависимости от
// доставки почты: создаём пользователя service-role'ом сразу подтверждённым
// (`email_confirm: true`). Клиент затем входит по паролю. Так регистрация не
// упирается ни в SMTP, ни в настройку «Confirm email».
export async function POST(request: Request) {
  // Не более 10 регистраций с одного IP в час.
  if (!(await checkRateLimit("register", clientIp(request), 10, 60 * 60 * 1000))) {
    return NextResponse.json(
      { error: "Слишком много попыток. Попробуйте позже." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    email?: unknown;
    password?: unknown;
  };
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Введите корректный email." }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Пароль — минимум 6 символов." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    const msg = error.message || "";
    if (/already|exists|registered|been/i.test(msg)) {
      return NextResponse.json(
        { error: "Аккаунт с этой почтой уже есть — войдите по паролю.", code: "exists" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: msg || "Не удалось создать аккаунт." }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
