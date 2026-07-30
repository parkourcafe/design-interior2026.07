// YandexGPT (Yandex Cloud Foundation Models) — основной провайдер продукта.
//
// Эндпоинт и формат сверены с официальной документацией Yandex Cloud (фаза 0):
//   POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion
//   modelUri: "gpt://<folder_id>/<model>/latest"  (напр. yandexgpt-lite/latest)
//   Заголовки: Authorization: Api-Key <YC_API_KEY>, x-folder-id: <folder>
// По состоянию на 2025 актуальные модели — поколение 5 в ветке /latest.
// Docs: https://yandex.cloud/ru/docs/foundation-models/text-generation/api-ref/TextGeneration/completion
//       https://yandex.cloud/ru/docs/foundation-models/quickstart/yandexgpt

const YANDEX_COMPLETION_URL =
  "https://llm.api.cloud.yandex.net/foundationModels/v1/completion";

interface YandexResponse {
  result?: {
    alternatives?: Array<{ message?: { text?: string } }>;
  };
}

export async function completeYandex(prompt: string): Promise<string> {
  const folderId = process.env.YC_FOLDER_ID;
  const rawApiKey = process.env.YC_API_KEY;
  const model = process.env.LLM_MODEL ?? "yandexgpt-lite";
  // Environment dashboards can preserve pasted line breaks. A bearer header
  // cannot contain them, so use the final Yandex-key token without logging its
  // value. Deployment configuration must still be normalized and rotated.
  const apiKeyCandidates = rawApiKey?.trim().split(/\s+/).filter(Boolean) ?? [];
  const apiKey =
    [...apiKeyCandidates].reverse().find((candidate) => candidate.startsWith("AQVN")) ??
    apiKeyCandidates.at(-1);

  if (!folderId || !apiKey) {
    throw new Error("YC_FOLDER_ID / YC_API_KEY are not set");
  }

  if (apiKeyCandidates.length > 1) {
    console.warn("[llm] normalized multi-line YC_API_KEY value");
  }

  // Позволяем указать в LLM_MODEL как короткое имя (yandexgpt-lite), так и
  // полный modelUri (gpt://...) — на случай кастомной/дообученной модели.
  const modelUri = model.startsWith("gpt://")
    ? model
    : `gpt://${folderId}/${model}/latest`;

  const res = await fetch(YANDEX_COMPLETION_URL, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${apiKey}`,
      "x-folder-id": folderId,
    },
    body: JSON.stringify({
      modelUri,
      completionOptions: {
        stream: false,
        temperature: 0.2,
        maxTokens: 2000,
      },
      messages: [{ role: "user", text: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`yandex_http_${res.status}: ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as YandexResponse;
  const text = json.result?.alternatives?.[0]?.message?.text;
  if (typeof text !== "string") {
    throw new Error("yandex_empty_completion");
  }
  return text;
}
