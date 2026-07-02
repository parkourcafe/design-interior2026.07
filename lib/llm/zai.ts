// z.ai (Zhipu AI, модели GLM) — OpenAI-совместимый провайдер.
//
// ⚠️ ОТСТУПЛЕНИЕ ОТ GUARDRAIL. CLAUDE.md явно запрещает «китайские LLM API в
// runtime продукта». Этот провайдер добавлен ПО ЯВНОМУ РЕШЕНИЮ ВЛАДЕЛЬЦА как
// опциональный (по умолчанию LLM_PROVIDER=yandex). Прежде чем включать его на
// проде с реальными брифами, учти 152-ФЗ: бриф содержит персональные данные
// клиента (состав семьи, бюджет, фото), а это трансграничная передача ПДн.
//
// Эндпоинт/формат сверены с офиц. документацией z.ai (OpenAI-совместимый):
//   POST {ZAI_BASE_URL}/chat/completions   (default base: https://api.z.ai/api/paas/v4)
//   Заголовок: Authorization: Bearer <ZAI_API_KEY>
//   Модель из LLM_MODEL (напр. glm-4.6). Docs: https://docs.z.ai/

const DEFAULT_BASE_URL = "https://api.z.ai/api/paas/v4";

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function completeZai(prompt: string): Promise<string> {
  const apiKey = process.env.ZAI_API_KEY;
  const baseUrl = (process.env.ZAI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const model = process.env.LLM_MODEL ?? "glm-4.6";

  if (!apiKey) {
    throw new Error("ZAI_API_KEY is not set");
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`zai_http_${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as OpenAiChatResponse;
  const text = json.choices?.[0]?.message?.content;
  if (typeof text !== "string") {
    throw new Error("zai_empty_completion");
  }
  return text;
}
