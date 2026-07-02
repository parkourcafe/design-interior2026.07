import type { ZodSchema } from "zod";
import { completeYandex } from "./yandex";
import { completeGigaChat } from "./gigachat";

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
  const { complete } = getRawCompletion();

  let raw: string;
  try {
    raw = await complete(prompt);
  } catch (e) {
    return { ok: false, error: `llm_request_failed: ${(e as Error).message}` };
  }

  const first = parseAndValidate(raw, schema);
  if (first.ok) return { ok: true, data: first.data, repaired: false };

  // repair-retry: просим модель вернуть только валидный JSON по схеме.
  const repairPrompt =
    `${prompt}\n\n---\nТвой предыдущий ответ не прошёл валидацию по схеме. ` +
    `Верни ТОЛЬКО валидный JSON строго по схеме, без пояснений, без markdown-обёртки.`;

  let repairedRaw: string;
  try {
    repairedRaw = await complete(repairPrompt);
  } catch (e) {
    return { ok: false, error: `llm_repair_failed: ${(e as Error).message}` };
  }

  const second = parseAndValidate(repairedRaw, schema);
  if (second.ok) return { ok: true, data: second.data, repaired: true };

  return { ok: false, error: "llm_invalid_json_after_repair" };
}
