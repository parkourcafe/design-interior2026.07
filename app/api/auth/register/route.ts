import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Регистрация выполняется request-bound Auth-клиентом. Service role не участвует
// в человеческих операциях и настройки подтверждения email остаются в силе.
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

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: new URL("/auth/callback", request.url).toString(),
    },
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

  return NextResponse.json({ ok: true, requiresConfirmation: !data.session });
}
