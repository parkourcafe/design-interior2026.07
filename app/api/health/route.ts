import { NextResponse } from "next/server";
import { isAiEnabled } from "@/lib/llm/ai-flag";

export const dynamic = "force-dynamic";

// Healthcheck: не бьёт по сети, только сообщает, какие подсистемы сконфигурированы.
export function GET() {
  const provider = process.env.LLM_PROVIDER ?? "yandex";
  const llmConfigured =
    provider === "zai"
      ? Boolean(process.env.ZAI_API_KEY)
      : provider === "gigachat"
        ? Boolean(process.env.GIGACHAT_AUTH_KEY)
        : Boolean(process.env.YC_FOLDER_ID && process.env.YC_API_KEY);

  const env = {
    supabase: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    supabase_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    // Включён ли AI вообще (по умолчанию нет, lib/llm/ai-flag.ts) — так владелец
    // может проверить на рабочем сайте, что данные никуда не уходят.
    ai_enabled: isAiEnabled(),
    llm_provider: provider,
    llm_configured: llmConfigured,
  };
  return NextResponse.json({
    status: "ok",
    ts: new Date().toISOString(),
    // На своём сервере коммит передаётся в APP_COMMIT при сборке образа.
    commit: process.env.APP_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    env,
  });
}
