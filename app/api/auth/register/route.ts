import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import {
  MARKET_ROUTING_COOKIE,
  MarketRoutingReceiptError,
  verifyMarketRoutingReceipt,
} from "@/lib/market/receipt";
import { createRegionalRouteClient } from "@/lib/supabase/regional";
import { RegionalSupabaseConfigurationError } from "@/lib/supabase/cells";
import { bindMarketRoutingReceipt } from "@/lib/market/bind";

export const dynamic = "force-dynamic";

// Регистрация выполняется request-bound Auth-клиентом. Service role не участвует
// в человеческих операциях и настройки подтверждения email остаются в силе.
export async function POST(request: NextRequest) {
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

  const rawReceipt = request.cookies.get(MARKET_ROUTING_COOKIE)?.value;
  let receipt;
  try {
    receipt = verifyMarketRoutingReceipt(rawReceipt);
  } catch (error) {
    const code = error instanceof MarketRoutingReceiptError ? error.message : "routing_receipt_invalid";
    return NextResponse.json({ error: code }, { status: 428 });
  }

  const response = NextResponse.json({ ok: true, requiresConfirmation: true });
  let supabase;
  try {
    supabase = createRegionalRouteClient(receipt.cellCode, request, response);
  } catch (error) {
    if (error instanceof RegionalSupabaseConfigurationError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    throw error;
  }
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: new URL(`/auth/callback?market_receipt=${encodeURIComponent(rawReceipt!)}`, request.url).toString(),
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

  if (data.session) {
    try {
      await bindMarketRoutingReceipt(supabase, rawReceipt!, receipt);
    } catch {
      await supabase.auth.signOut();
      return NextResponse.json({ error: "market_routing_binding_failed" }, { status: 503 });
    }
  }

  return response;
}
