import type { ZodSchema } from "zod";
import { completeYandex } from "./yandex";
import { completeGigaChat } from "./gigachat";
import { completeZai } from "./zai";
import { providerErrorCode, recordAiCallBestEffort, type AiCallContext } from "./recording";

// Провайдер спрятан за единственным методом completeJSON(prompt, schema).
// Смена YandexGPT → GigaChat → западный провайдер (EN-экспансия) не трогает
// продуктовый код: меняется только LLM_PROVIDER в env.
//
// Вызовы разрешены ТОЛЬКО из server route handlers (см. CLAUDE.md).

export type LlmResult<T> =
  | { ok: true; data: T; repaired: boolean }
  | { ok: false; error: string };

// Низкоуровневый контракт конкретного провайдера: prompt → сырой текст ответа.
export type RawCompletion = (prompt: string) => Promise<string>;

// 'zai' — опциональный OpenAI-совместимый провайдер (Zhipu GLM). Включается
// только через LLM_PROVIDER=zai; по умолчанию продукт остаётся на YandexGPT.
// См. предупреждение о guardrail/152-ФЗ в lib/llm/zai.ts.
export type ProviderName = "yandex" | "gigachat" | "zai";

const DEFAULT_MODELS: Record<ProviderName, string> = {
  yandex: "yandexgpt-lite",
  gigachat: "gigachat",
  zai: "glm-4.6",
};

function getRawCompletion(): {
  name: ProviderName;
  model: string;
  complete: RawCompletion;
} {
  const provider = (process.env.LLM_PROVIDER ?? "yandex") as ProviderName;
  const model = process.env.LLM_MODEL ?? DEFAULT_MODELS[provider];
  switch (provider) {
    case "gigachat":
      return { name: "gigachat", model, complete: completeGigaChat };
    case "zai":
      return { name: "zai", model, complete: completeZai };
    case "yandex":
    default:
      return { name: "yandex", model, complete: completeYandex };
  }
}

// Вырезает JSON из ответа модели, которая иногда оборачивает его в ```json ... ```
// или добавляет пояснения до/после.
export function extractJson(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();

  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace === -1) return trimmed;
  const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
  if (lastBrace <= firstBrace) return trimmed;
  return trimmed.slice(firstBrace, lastBrace + 1);
}

function parseAndValidate<T>(raw: string, schema: ZodSchema<T>): { ok: true; data: T } | { ok: false } {
  try {
    const parsed = JSON.parse(extractJson(raw));
    const result = schema.safeParse(parsed);
    if (result.success) return { ok: true, data: result.data };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

// Любой ответ LLM — строгий JSON по схеме. Парсинг через Zod safeParse; при
// провале — один repair-retry, затем ошибка (вызывающий код показывает
// rule-карточки, UX не падает).
// Защита на точке интеграции: рекордер уже best-effort изнутри, но сбой
// самого модуля учёта не должен дотянуться до продуктового результата.
async function recordAttempt(
  ctx: AiCallContext | undefined,
  provider: string,
  model: string,
  status: "ok" | "error",
  errorCode: string | null,
  prompt: string,
  completionText: string | null,
  startedAt: number,
): Promise<void> {
  try {
    await recordAiCallBestEffort({
      ctx, provider, model, status, errorCode, prompt, completionText,
      durationMs: Date.now() - startedAt,
    });
  } catch {
    // учёт не роняет основной вызов (ТЗ A2)
  }
}

// Каждая попытка обращения к провайдеру — одна строка учёта (DEC-009):
// успех и отказ пишутся одинаково, отказ — со слагом кода без тела ответа.
// Учёт best-effort: падение записи не влияет на результат вызова.
export async function completeJSON<T>(
  prompt: string,
  schema: ZodSchema<T>,
  ctx?: AiCallContext,
): Promise<LlmResult<T>> {
  const { name: provider, model, complete } = getRawCompletion();

  let raw: string;
  const startedAt = Date.now();
  try {
    raw = await complete(prompt);
  } catch (e) {
    await recordAttempt(ctx, provider, model, "error",
      providerErrorCode(e), prompt, null, startedAt);
    return { ok: false, error: `llm_request_failed: ${(e as Error).message}` };
  }
  await recordAttempt(ctx, provider, model, "ok", null, prompt, raw, startedAt);

  const first = parseAndValidate(raw, schema);
  if (first.ok) return { ok: true, data: first.data, repaired: false };

  // repair-retry: просим модель вернуть только валидный JSON по схеме.
  const repairPrompt =
    `${prompt}\n\n---\nТвой предыдущий ответ не прошёл валидацию по схеме. ` +
    `Верни ТОЛЬКО валидный JSON строго по схеме, без пояснений, без markdown-обёртки.`;

  let repairedRaw: string;
  const repairStartedAt = Date.now();
  try {
    repairedRaw = await complete(repairPrompt);
  } catch (e) {
    await recordAttempt(ctx, provider, model, "error",
      providerErrorCode(e), repairPrompt, null, repairStartedAt);
    return { ok: false, error: `llm_repair_failed: ${(e as Error).message}` };
  }
  await recordAttempt(ctx, provider, model, "ok", null, repairPrompt, repairedRaw, repairStartedAt);

  const second = parseAndValidate(repairedRaw, schema);
  if (second.ok) return { ok: true, data: second.data, repaired: true };

  return { ok: false, error: "llm_invalid_json_after_repair" };
}
