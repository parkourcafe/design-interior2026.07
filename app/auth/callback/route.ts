import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Установка сессии из magic link. Поддерживаем ДВА варианта, чтобы вход был
// надёжным независимо от настроек проекта и от того, в каком браузере открыто
// письмо:
//   1) ?code=...              — PKCE-обмен (exchangeCodeForSession). Требует
//                               code_verifier из ТОГО ЖЕ браузера.
//   2) ?token_hash=...&type=  — verifyOtp по хэшу токена. Stateless: работает,
//                               даже если письмо открыто в другом браузере.
//                               Для этого шаблон письма должен вести на
//                               {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // Только внутренний путь ("/dashboard", "/dashboard/..."), никаких внешних
  // редиректов: next должен начинаться с одной "/" (не "//" и не "/\").
  const nextParam = searchParams.get("next");
  const next = nextParam && /^\/(?![/\\])/.test(nextParam) ? nextParam : "/dashboard";

  const supabase = await createClient();

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Ни code, ни token_hash — ссылка пришла без параметров (частый признак того,
  // что redirect_to не в allow-list и Supabase увёл на Site URL).
  return NextResponse.redirect(`${origin}/login?error=no_auth_params`);
}
