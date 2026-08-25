// Учёт вызовов AI (DEC-009, Фаза 2 A2). Каждая попытка обращения к
// провайдеру — одна строка в projectceo_platform.ai_calls через системную
// дверь record_ai_call (только service_role). Best-effort: сбой учёта
// НЕ роняет основной вызов — счётчик расходов не стоит слома UX.
//
// ЧЕГО ЗДЕСЬ НЕТ. Ни текстов промптов/ответов — наружу идут только длины и
// sha256 промпта (односторонний); ни кодов ошибок провайдера целиком —
// только слаг до первого двоеточия (тело ответа провайдера может нести
// эхо промпта). PII в учёте нет по построению, форма таблицы это
// запрещает на уровне схемы.

import { createHash } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

export interface AiCallContext {
  /** Откуда вызов: brief | risks | proposal | documentation | execution | platform */
  readonly module: string;
  /** Зачем: короткий слаг (custom_question, risk_cards, …). */
  readonly purpose: string;
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly actorUserId?: string;
}

export interface AiCallRecordInput {
  readonly ctx?: AiCallContext;
  readonly provider: string;
  readonly model: string;
  readonly status: "ok" | "error";
  readonly errorCode: string | null;
  readonly prompt: string;
  readonly completionText: string | null;
  readonly durationMs: number | null;
}

export function promptSha256(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

/** Только слаг отказа — без тела ответа провайдера. */
export function providerErrorCode(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return (raw.split(":")[0] ?? "").slice(0, 80) || "llm_unknown_error";
}

export async function recordAiCallBestEffort(
  input: AiCallRecordInput,
): Promise<void> {
  try {
    // Без сервисного ключа (юнит-тесты, сборка) учёт молча пропускается:
    // писать некому и некуда, а основной вызов это не касается.
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;

    const admin = createAdminClient();
    const { error } = await admin
      .schema("projectceo_platform_api")
      .rpc("record_ai_call", {
        p_module: input.ctx?.module ?? "unknown",
        p_purpose: input.ctx?.purpose ?? "unknown",
        p_provider: input.provider,
        p_model: input.model,
        p_status: input.status,
        p_error_code: input.errorCode,
        p_prompt_chars: input.prompt.length,
        p_prompt_sha256: promptSha256(input.prompt),
        p_completion_chars: input.completionText?.length ?? null,
        p_duration_ms: input.durationMs,
        p_organization_id: input.ctx?.organizationId ?? null,
        p_project_id: input.ctx?.projectId ?? null,
        p_actor_user_id: input.ctx?.actorUserId ?? null,
      });
    if (error) {
      // Код ошибки — служебный, без тела и без PII.
      console.warn("ai_call_record_failed:", error.message?.slice(0, 120));
    }
  } catch {
    // best-effort (ТЗ A2): сбой учёта не роняет основной вызов.
  }
}
