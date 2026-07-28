import type { ZodSchema } from "zod";
import { completeYandex } from "./yandex";
import { completeGigaChat } from "./gigachat";

// Провайдер спрятан за единственным методом completeJSON(prompt, schema).
// Смена YandexGPT → GigaChat → западный провайдер (EN-экспансия) не трогает
// продуктовый код: меняется только LLM_PROVIDER в env.
//
// Вызовы разрешены ТОЛЬКО из server route handlers (см. CLAUDE.md).

export type LlmResult<T> =
  | { ok: true; data: T; repaired: boolean; usage: LlmUsage }
  | { ok: false; error: string; usage: LlmUsage };

export interface LlmUsage {
  provider: ProviderName;
  model: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  providerCostEstimate: number;
  estimateSource: "static_table";
  outcome: "success" | "schema_fail" | "provider_error" | "timeout";
  attempts: number;
}

// Низкоуровневый контракт конкретного провайдера: prompt → сырой текст ответа.
export type RawCompletion = (prompt: string) => Promise<string>;

export type ProviderName = "yandex" | "gigachat";

function getRawCompletion(): { name: ProviderName; complete: RawCompletion } {
  const provider = (process.env.LLM_PROVIDER ?? "yandex") as ProviderName;
  switch (provider) {
    case "gigachat":
      return { name: "gigachat", complete: completeGigaChat };
    case "yandex":
    default:
      return { name: "yandex", complete: completeYandex };
  }
}

function estimatedTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 4));
}

function buildUsage(
  provider: ProviderName,
  prompt: string,
  outputs: string[],
  startedAt: number,
  outcome: LlmUsage["outcome"],
): LlmUsage {
  const tokensIn = estimatedTokens(prompt) * Math.max(outputs.length, 1);
  const tokensOut = outputs.reduce((sum, output) => sum + estimatedTokens(output), 0);
  const rubPerThousand = Number(process.env.LLM_ESTIMATED_RUB_PER_1K_TOKENS ?? "0");
  return {
    provider,
    model: process.env.LLM_MODEL ?? "unknown",
    tokensIn,
    tokensOut,
    durationMs: Date.now() - startedAt,
    providerCostEstimate: Number((((tokensIn + tokensOut) / 1000) * rubPerThousand).toFixed(6)),
    estimateSource: "static_table",
    outcome,
    attempts: Math.max(outputs.length, 1),
  };
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
export async function completeJSON<T>(prompt: string, schema: ZodSchema<T>): Promise<LlmResult<T>> {
  const { name, complete } = getRawCompletion();
  const startedAt = Date.now();
  const outputs: string[] = [];

  let raw: string;
  try {
    raw = await complete(prompt);
    outputs.push(raw);
  } catch (e) {
    const message = (e as Error).message;
    return { ok: false, error: `llm_request_failed: ${message}`, usage: buildUsage(name, prompt, outputs, startedAt, /timeout/i.test(message) ? "timeout" : "provider_error") };
  }

  const first = parseAndValidate(raw, schema);
  if (first.ok) return { ok: true, data: first.data, repaired: false, usage: buildUsage(name, prompt, outputs, startedAt, "success") };

  // repair-retry: просим модель вернуть только валидный JSON по схеме.
  const repairPrompt =
    `${prompt}\n\n---\nТвой предыдущий ответ не прошёл валидацию по схеме. ` +
    `Верни ТОЛЬКО валидный JSON строго по схеме, без пояснений, без markdown-обёртки.`;

  let repairedRaw: string;
  try {
    repairedRaw = await complete(repairPrompt);
    outputs.push(repairedRaw);
  } catch (e) {
    const message = (e as Error).message;
    return { ok: false, error: `llm_repair_failed: ${message}`, usage: buildUsage(name, prompt, outputs, startedAt, /timeout/i.test(message) ? "timeout" : "provider_error") };
  }

  const second = parseAndValidate(repairedRaw, schema);
  if (second.ok) return { ok: true, data: second.data, repaired: true, usage: buildUsage(name, prompt, outputs, startedAt, "success") };

  return { ok: false, error: "llm_invalid_json_after_repair", usage: buildUsage(name, prompt, outputs, startedAt, "schema_fail") };
}
