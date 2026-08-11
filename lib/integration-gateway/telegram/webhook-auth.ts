import { timingSafeEqual } from "node:crypto";

/**
 * Проверка заголовка `X-Telegram-Bot-Api-Secret-Token`.
 *
 * Это ЕДИНСТВЕННОЕ, что отличает настоящий webhook Telegram от любого запроса
 * в интернете: URL webhook'а знает кто угодно, кто его однажды видел, а тела
 * запроса Telegram не подписывает. Поэтому сравнение обязано быть
 * постоянного времени — иначе секрет подбирается по времени ответа побайтно.
 *
 * Отсутствие заголовка и неверный заголовок — один и тот же отказ. Разные
 * ответы подсказывали бы, настроен ли секрет вообще.
 */
export function isAuthenticTelegramWebhook(
  headerValue: string | null | undefined,
  expectedSecret: string,
): boolean {
  if (expectedSecret === "") return false;
  if (typeof headerValue !== "string" || headerValue === "") return false;

  const provided = Buffer.from(headerValue, "utf8");
  const expected = Buffer.from(expectedSecret, "utf8");
  if (provided.byteLength !== expected.byteLength) {
    // `timingSafeEqual` бросает на разной длине, поэтому длина сверяется
    // отдельно. Длина секрета — не тайна; тайна — его содержимое.
    return false;
  }
  return timingSafeEqual(provided, expected);
}

export const TELEGRAM_WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";
