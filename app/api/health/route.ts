import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Healthcheck: не бьёт по сети, только сообщает, какие подсистемы сконфигурированы.
export function GET() {
  const env = {
    supabase: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
    supabase_service_role: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    llm_provider: process.env.LLM_PROVIDER ?? "yandex",
    llm_configured: Boolean(process.env.YC_FOLDER_ID && process.env.YC_API_KEY),
  };
  return NextResponse.json({ status: "ok", ts: new Date().toISOString(), env });
}
