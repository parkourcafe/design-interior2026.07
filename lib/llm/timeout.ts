// Ограничение ожидания ответа AI (аудит 28.09, шаг 5). Без него зависший
// провайдер держал запрос до лимита платформы: функция обрывалась раньше, чем
// срабатывал переход на карточки по правилам, паспорт не сохранялся, а клиент
// видел ошибку отправки брифа.
//
// LLM_TIMEOUT_MS — на один вызов провайдера (по умолчанию 20 с);
// LLM_TOTAL_BUDGET_MS — на весь completeJSON вместе с повтором (35 с).
// Вызов, на который бюджета не осталось, не начинается.

const DEFAULT_CALL_MS = 20_000;
const DEFAULT_TOTAL_MS = 35_000;

function envMs(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function llmCallTimeoutMs(): number {
  return envMs("LLM_TIMEOUT_MS", DEFAULT_CALL_MS, 100, 120_000);
}

export function llmTotalBudgetMs(): number {
  return envMs("LLM_TOTAL_BUDGET_MS", DEFAULT_TOTAL_MS, 100, 300_000);
}

/** Сигнал отмены запроса к провайдеру: прерывает и соединение, и чтение тела. */
export function llmSignal(timeoutMs: number = llmCallTimeoutMs()): AbortSignal {
  return AbortSignal.timeout(Math.max(1, Math.round(timeoutMs)));
}

/** Код ошибки для отказа по таймауту — без текста ответа провайдера. */
export function isLlmTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}
