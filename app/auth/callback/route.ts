import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import {
  MARKET_ROUTING_COOKIE,
  MarketRoutingReceiptError,
  marketReceiptCookieOptions,
  verifyMarketRoutingReceipt,
} from "@/lib/market/receipt";
import { createRegionalRouteClient } from "@/lib/supabase/regional";
import { RegionalSupabaseConfigurationError } from "@/lib/supabase/cells";
import { bindMarketRoutingReceipt } from "@/lib/market/bind";
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
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const rawReceipt = request.cookies.get(MARKET_ROUTING_COOKIE)?.value
    ?? searchParams.get("market_receipt")
    ?? undefined;
  // Только внутренний путь ("/dashboard", "/dashboard/..."), никаких внешних
  // редиректов: next должен начинаться с одной "/" (не "//" и не "/\").
  const nextParam = searchParams.get("next");
  const next = nextParam && /^\/(?![/\\])/.test(nextParam) ? nextParam : "/dashboard";

  // Existing RU accounts and old magic links predate market receipts. They stay
  // on the established RU-only client; new registration always arrives here
  // with a signed receipt from /api/auth/register.
  if (!rawReceipt) {
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
    return NextResponse.redirect(`${origin}/login?error=no_auth_params`);
  }

  let receipt: ReturnType<typeof verifyMarketRoutingReceipt>;
  try {
    receipt = verifyMarketRoutingReceipt(rawReceipt);
  } catch (error) {
    const code = error instanceof MarketRoutingReceiptError ? error.message : "routing_receipt_invalid";
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(code)}`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);
  response.cookies.set(MARKET_ROUTING_COOKIE, rawReceipt!, marketReceiptCookieOptions());
  let supabase: ReturnType<typeof createRegionalRouteClient>;
  try {
    supabase = createRegionalRouteClient(receipt.cellCode, request, response);
  } catch (error) {
    const code = error instanceof RegionalSupabaseConfigurationError ? error.message : "regional_cell_not_configured";
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(code)}`);
  }

  async function bindAndRedirect() {
    try {
      await bindMarketRoutingReceipt(supabase, rawReceipt!, receipt);
      return response;
    } catch {
      await supabase.auth.signOut();
      return NextResponse.redirect(`${origin}/login?error=market_routing_binding_failed`);
    }
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return bindAndRedirect();
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return bindAndRedirect();
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Ни code, ни token_hash — ссылка пришла без параметров (частый признак того,
  // что redirect_to не в allow-list и Supabase увёл на Site URL).
  return NextResponse.redirect(`${origin}/login?error=no_auth_params`);
}
