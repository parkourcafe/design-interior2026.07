import "server-only";

/**
 * Учётные данные Telegram — читаются из окружения и НИКОГДА не покидают сервер.
 *
 * Почему отдельный модуль, а не `process.env` по месту: чтобы существовало
 * ровно одно место, про которое можно доказать три вещи — токен не попадает в
 * БД, не попадает в лог и не попадает в браузерный бандл. Разбросанные
 * обращения такого доказательства не допускают.
 *
 * Имена переменных содержат `TEST_` осознанно. A7 §1.11 разрешает P0 только в
 * local, CI и закрытом staging; production — отдельное решение владельца. Пока
 * его нет, у продовых имён переменных нет и повода появиться: назвать их
 * `TELEGRAM_BOT_TOKEN` значило бы заранее приготовить продовый слот.
 */

export interface TelegramCredentials {
  /** Токен бота. Уходит только в URL к api.telegram.org. */
  readonly botToken: string;
  /** Секрет заголовка `X-Telegram-Bot-Api-Secret-Token`. */
  readonly webhookSecret: string;
  /** Username бота без `@` — из него строится ссылка `t.me/…`. */
  readonly botUsername: string;
  /**
   * Идентификатор бота (число до двоеточия в токене). Он же
   * `bot_instance_id` в базе: один и тот же чат, подключённый разными ботами,
   * — это разные подключения, и путать их нельзя.
   */
  readonly botInstanceId: string;
}

export type TelegramCredentialsResult =
  | { readonly ok: true; readonly credentials: TelegramCredentials }
  | { readonly ok: false; readonly missing: readonly string[] };

type TelegramEnvSource = Readonly<Record<string, string | undefined>>;

const REQUIRED = [
  "TELEGRAM_TEST_BOT_TOKEN",
  "TELEGRAM_TEST_WEBHOOK_SECRET",
  "TELEGRAM_TEST_BOT_USERNAME",
] as const;

/**
 * Идентификатор бота — префикс токена до двоеточия. Разбор намеренно строгий:
 * если токен не той формы, лучше отказать на старте, чем отправить мусор в
 * `bot_instance_id` и получить связь, которую невозможно сопоставить с ботом.
 */
export function botInstanceIdFromToken(token: string): string | null {
  const match = /^(\d{5,20}):[A-Za-z0-9_-]{30,}$/.exec(token);
  return match === null ? null : (match[1] ?? null);
}

/**
 * Источник значений передаётся параметром — так тест проверяет разбор, не
 * трогая `process.env` всего прогона. Тип нарочно шире `NodeJS.ProcessEnv`:
 * функция читает три известных ключа и ничего не знает про остальное
 * окружение, а требовать `NODE_ENV` от вызывающего было бы требованием
 * из ниоткуда.
 */
export function readTelegramCredentials(
  env: TelegramEnvSource = process.env,
): TelegramCredentialsResult {
  const missing = REQUIRED.filter((name) => (env[name] ?? "").trim() === "");
  if (missing.length > 0) return { ok: false, missing };

  const botToken = (env.TELEGRAM_TEST_BOT_TOKEN ?? "").trim();
  const botInstanceId = botInstanceIdFromToken(botToken);
  if (botInstanceId === null) {
    // Имя переменной назвать можно, значение — нет.
    return { ok: false, missing: ["TELEGRAM_TEST_BOT_TOKEN"] };
  }

  return {
    ok: true,
    credentials: {
      botToken,
      webhookSecret: (env.TELEGRAM_TEST_WEBHOOK_SECRET ?? "").trim(),
      botUsername: (env.TELEGRAM_TEST_BOT_USERNAME ?? "").trim().replace(/^@/, ""),
      botInstanceId,
    },
  };
}

/**
 * Тестовая группа для внешнего гейта TG4. Отсутствие переменной блокирует
 * ТОЛЬКО TG4 (A7 §3) и не мешает ни одному из гейтов TG0–TG3.
 */
export function readTelegramStagingChatId(
  env: TelegramEnvSource = process.env,
): number | null {
  const raw = (env.TELEGRAM_TEST_CHAT_ID ?? "").trim();
  if (!/^-?\d{1,19}$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}
